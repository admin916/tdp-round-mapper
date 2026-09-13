-- Background course building: the app drops a request when a search finds no
-- library course; the Course Scout (scripts/course-scout.mjs, running next to a
-- God's Eye View server) picks it up, builds the course and adds it to the catalogue.
create table if not exists public.course_requests (
  id           bigint generated always as identity primary key,
  name         text not null,
  place        text,
  status       text not null default 'pending' check (status in ('pending','building','done','failed')),
  course_id    text references public.courses(id) on delete set null,
  error        text,
  requested_by uuid references auth.users on delete set null,
  attempts     int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists course_requests_status_idx on public.course_requests (status, created_at);
create unique index if not exists course_requests_open_name_idx on public.course_requests (lower(name)) where status in ('pending','building');
alter table public.course_requests enable row level security;
create policy "anyone can request a course" on public.course_requests for insert with check (true);
create policy "requests readable by all" on public.course_requests for select using (true);
