-- ═══════════════════════════════════════════════════════════════════
-- TDP Phase 1 — auth, profiles & per-user persistence
-- Spec: TDP-Auth-Profiles-Spec.html §4 (schema) + §8.1 (player_model)
-- Apply with:  supabase db push   (or paste into the dashboard SQL editor)
-- ═══════════════════════════════════════════════════════════════════

-- ── 1 · profiles ────────────────────────────────────────────────────
create table public.profiles (
  id           uuid primary key references auth.users on delete cascade,
  display_name text,
  home_club    text,
  default_tees text default 'White',
  units        text default 'yd' check (units in ('yd','m')),
  whs_id       text,
  handicap_idx numeric(4,1),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- keep updated_at honest on any table that has one
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

alter table public.profiles enable row level security;
create policy "read own profile"   on public.profiles for select using (auth.uid() = id);
create policy "update own profile" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

-- ── 2 · courses (shared catalogue) ──────────────────────────────────
create table public.courses (
  id         text primary key,               -- slug: 'wentworth-club-west-course'
  name       text not null,
  location   text,
  geometry   jsonb not null,                 -- full TDP_COURSE-shaped object
  source     text not null default 'built-in'
             check (source in ('built-in','osm','course-fn','user')),
  created_by uuid references auth.users on delete set null,
  play_count int not null default 0,
  flagged    boolean not null default false, -- "report a problem with this course"
  created_at timestamptz not null default now()
);

alter table public.courses enable row level security;
-- catalogue is readable by everyone, including signed-out guests
create policy "courses readable by all" on public.courses
  for select using (true);
-- signed-in users may contribute courses they built/mapped themselves;
-- the Edge Functions write with the service role and bypass RLS
create policy "users add own courses" on public.courses
  for insert to authenticated
  with check (created_by = auth.uid() and source in ('user','osm'));

-- ── 3 · course_sessions (Day 1/2/3 trips & blocks) ──────────────────
create table public.course_sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  title      text not null,
  course_id  text references public.courses,
  starts_on  date,
  ends_on    date,
  notes      text,
  created_at timestamptz not null default now()
);

alter table public.course_sessions enable row level security;
create policy "own sessions" on public.course_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── 4 · rounds (one row per round — history, not overwrite) ─────────
create table public.rounds (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  course_id    text not null references public.courses,
  session_id   uuid references public.course_sessions on delete set null,
  played_on    date not null,
  tees         text,
  status       text not null default 'active'
               check (status in ('active','complete','abandoned')),
  data         jsonb not null,               -- the round object app.js serialises
  score        int,
  putts        int,
  footage_ft   numeric(6,1),
  differential numeric(4,1),
  device_id    text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index rounds_user_played on public.rounds (user_id, played_on desc);
create index rounds_session on public.rounds (session_id) where session_id is not null;

create trigger rounds_touch before update on public.rounds
  for each row execute function public.touch_updated_at();

alter table public.rounds enable row level security;
create policy "own rounds" on public.rounds
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── 5 · course_conditions (daily pin & tee movement) ────────────────
create table public.course_conditions (
  id         uuid primary key default gen_random_uuid(),
  course_id  text not null references public.courses,
  on_date    date not null,
  user_id    uuid references auth.users on delete cascade,
  pins       jsonb,   -- { "1": {lat,lng,quadrant}, ... }
  tees       jsonb,   -- { "1": {lat,lng,box}, ... }
  created_at timestamptz not null default now(),
  unique (course_id, on_date, user_id)
);

create index conditions_course_date on public.course_conditions (course_id, on_date desc);

alter table public.course_conditions enable row level security;
-- shared-read: today's pin sheet benefits everyone on the course
create policy "conditions readable by all" on public.course_conditions
  for select using (true);
create policy "write own conditions" on public.course_conditions
  for insert to authenticated with check (user_id = auth.uid());
create policy "update own conditions" on public.course_conditions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "delete own conditions" on public.course_conditions
  for delete using (user_id = auth.uid());

-- ── 6 · shot_samples (heat-map / club-speed source data) ────────────
create table public.shot_samples (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users on delete cascade,
  round_id   uuid references public.rounds on delete cascade,
  course_id  text,
  hole       int,
  club       text,
  club_speed numeric(5,1),
  carry_m    numeric(5,1),
  lat        double precision,
  lng        double precision,
  start_lie  text check (start_lie in ('tee','fairway','rough','sand','recovery','green')),
  result     text check (result in ('fairway','rough','sand','green','water','penalty','holed')),
  offline_deg numeric(4,1),                  -- lateral miss angle vs target line
  created_at timestamptz not null default now()
);

create index shot_samples_user_club on public.shot_samples (user_id, club);

alter table public.shot_samples enable row level security;
create policy "own shots" on public.shot_samples
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── 7 · player_model (aggregated per-user profile, read-only client) ─
create table public.player_model (
  user_id     uuid primary key references auth.users on delete cascade,
  clubs       jsonb not null default '{}',
  sg_by_lie   jsonb,
  footage_avg numeric(5,1),
  updated_at  timestamptz not null default now()
);

alter table public.player_model enable row level security;
create policy "read own model" on public.player_model
  for select using (auth.uid() = user_id);
-- writes happen via recompute function / service role only (no client policy)

-- ── 8 · player_model recompute ──────────────────────────────────────
-- Cheap enough to run on demand (round completion) from an Edge Function
-- or the client via rpc; security definer so it can upsert past RLS.
create or replace function public.recompute_player_model(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user is distinct from auth.uid() and auth.role() <> 'service_role' then
    raise exception 'not allowed';
  end if;

  insert into public.player_model (user_id, clubs, footage_avg, updated_at)
  select
    p_user,
    coalesce(jsonb_object_agg(club, stats) filter (where club is not null), '{}'),
    (select avg(footage_ft) from public.rounds
      where user_id = p_user and status = 'complete' and footage_ft is not null),
    now()
  from (
    select club,
           jsonb_build_object(
             'carry_p50', percentile_cont(0.5)  within group (order by carry_m),
             'carry_p75', percentile_cont(0.75) within group (order by carry_m),
             'lat_sd_deg', stddev_samp(offline_deg),
             'samples', count(*),
             'source', 'derived'
           ) as stats
    from public.shot_samples
    where user_id = p_user and carry_m is not null
    group by club
  ) per_club
  on conflict (user_id) do update
    set clubs = excluded.clubs,
        footage_avg = excluded.footage_avg,
        updated_at = excluded.updated_at;
end $$;

grant execute on function public.recompute_player_model(uuid) to authenticated;
