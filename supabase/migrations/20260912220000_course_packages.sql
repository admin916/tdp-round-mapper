-- Version geometry independently of daily conditions and preserve historical rounds.
alter table public.courses add column course_uuid uuid not null default gen_random_uuid() unique,
  add column map_status text not null default 'unreviewed' check(map_status in ('unreviewed','needs_review','reviewed')),
  add column current_revision uuid;
create table public.course_revisions (
  id uuid primary key default gen_random_uuid(), course_id text not null references public.courses(id),
  version int not null, geometry jsonb not null, provenance jsonb not null default '{}',
  review_status text not null, created_at timestamptz not null default now(), unique(course_id,version)
);
alter table public.course_revisions enable row level security;
create policy "course revisions readable" on public.course_revisions for select using(true);
revoke insert,update,delete on public.course_revisions from anon,authenticated;
grant select on public.course_revisions to anon,authenticated;
alter table public.courses add constraint courses_revision_fk foreign key(current_revision) references public.course_revisions(id);
alter table public.rounds add column course_revision_id uuid references public.course_revisions(id);
create or replace function public.snapshot_course_revision() returns trigger language plpgsql security definer set search_path=public as $$
declare revision uuid:=gen_random_uuid(); v int;
begin
  if TG_OP='UPDATE' and new.geometry is not distinct from old.geometry and new.map_status=old.map_status then return new; end if;
  select coalesce(max(version),0)+1 into v from public.course_revisions where course_id=new.id;
  insert into public.course_revisions(id,course_id,version,geometry,provenance,review_status)
    values(revision,new.id,v,jsonb_set(new.geometry,'{course,revisionId}',to_jsonb(revision)),coalesce(new.geometry->'provenance','{}'),new.map_status);
  update public.courses set current_revision=revision where id=new.id;
  return new;
end $$;
create trigger courses_versioned after insert or update of geometry,map_status on public.courses for each row execute function public.snapshot_course_revision();
-- Capture the existing catalogue without changing any geometry or review claims.
insert into public.course_revisions(course_id,version,geometry,provenance,review_status)
  select id,1,geometry,coalesce(geometry->'provenance','{}'),map_status from public.courses;
update public.courses c set current_revision=r.id from public.course_revisions r where r.course_id=c.id and r.version=1;

create table public.course_reviewers(user_id uuid primary key references auth.users(id) on delete cascade);
alter table public.course_reviewers enable row level security;
create policy "read reviewer membership" on public.course_reviewers for select to authenticated using(user_id=auth.uid());
grant select on public.course_reviewers to authenticated;
create table public.course_map_drafts (
  id uuid primary key default gen_random_uuid(), created_by uuid not null references auth.users(id),
  course_id text not null, package jsonb not null check(jsonb_typeof(package)='object'),
  status text not null default 'submitted' check(status in ('submitted','published','rejected')),
  review_note text, reviewed_by uuid references auth.users(id), reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.course_map_drafts enable row level security;
create policy "submit own map draft" on public.course_map_drafts for insert to authenticated with check(
  created_by=auth.uid() and status='submitted' and reviewed_by is null and reviewed_at is null and review_note is null
  and course_id=package->'course'->>'id' and pg_column_size(package)<5000000);
create policy "read own or review drafts" on public.course_map_drafts for select to authenticated using(
  created_by=auth.uid() or exists(select 1 from public.course_reviewers where user_id=auth.uid()));
revoke insert,update,delete on public.course_map_drafts from anon,authenticated;
grant insert(created_by,course_id,package),select on public.course_map_drafts to authenticated;
-- Only the validated review service can publish. It records the authenticated reviewer.
create or replace function public.publish_course_draft(p_draft uuid,p_reviewer uuid,p_geometry jsonb,p_note text)
returns uuid language plpgsql set search_path=public as $$
declare d public.course_map_drafts; revision uuid;
begin
  if not exists(select 1 from public.course_reviewers where user_id=p_reviewer) then raise exception 'Reviewer access required';end if;
  select * into d from public.course_map_drafts where id=p_draft and status='submitted' for update;
  if not found then raise exception 'Draft has already been reviewed';end if;
  if p_geometry->'course'->>'id' is distinct from d.course_id then raise exception 'Course identity mismatch';end if;
  insert into public.courses(id,name,location,geometry,source,quality,coverage,country,map_status)
    values(d.course_id,p_geometry->'course'->>'name',p_geometry->'course'->>'location',p_geometry,'user',p_geometry->>'quality',p_geometry->'coverage',p_geometry->'identity'->>'country','reviewed')
    on conflict(id) do update set name=excluded.name,location=excluded.location,geometry=excluded.geometry,
      source='user',quality=excluded.quality,coverage=excluded.coverage,map_status='reviewed',updated_at=now();
  select current_revision into revision from public.courses where id=d.course_id;
  update public.course_map_drafts set status='published',reviewed_by=p_reviewer,reviewed_at=now(),review_note=p_note where id=p_draft;
  return revision;
end $$;
revoke all on function public.publish_course_draft(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.publish_course_draft(uuid,uuid,jsonb,text) to service_role;
-- A round cannot be attached to another course's revision or silently rebound later.
create or replace function public.check_round_course_revision() returns trigger language plpgsql set search_path=public as $$
begin
  if new.course_revision_id is not null and not exists(select 1 from public.course_revisions where id=new.course_revision_id and course_id=new.course_id) then
    raise exception 'Round revision belongs to another course';end if;
  if TG_OP='UPDATE' and old.course_revision_id is not null and new.course_revision_id is distinct from old.course_revision_id then
    raise exception 'A saved round keeps its original course revision';end if;
  return new;
end $$;
create trigger rounds_revision_checked before insert or update on public.rounds for each row execute function public.check_round_course_revision();
create policy "contributions are unreviewed" on public.courses as restrictive for insert to authenticated
  with check(map_status='unreviewed' and current_revision is null);
create or replace function public.limit_course_requests() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if auth.role()='service_role' then return new;end if;
  perform pg_advisory_xact_lock(7473371);
  if (select count(*) from public.course_requests where created_at>now()-interval '1 hour')>=120
     or (new.requested_by is not null and (select count(*) from public.course_requests where requested_by=new.requested_by and created_at>now()-interval '1 hour')>=10) then
    raise exception 'Mapping requests are busy. Please try again later.' using errcode='P0001';
  end if;
  return new;
end $$;
revoke all on function public.limit_course_requests() from public,anon,authenticated;
create trigger course_requests_limited before insert on public.course_requests for each row execute function public.limit_course_requests();
-- Shared publication entry point for immediate builds and bulk imports.
create or replace function public.publish_osm_course(p_course jsonb) returns jsonb language plpgsql set search_path=public as $$
declare result jsonb;
begin
  insert into public.courses(id,name,location,geometry,source,quality,coverage,country,osm_id)
    values(p_course->>'id',p_course->>'name',p_course->>'location',p_course->'geometry','osm',p_course->>'quality',p_course->'coverage',p_course->>'country',(p_course->>'osm_id')::bigint)
    on conflict(id) do update set geometry=excluded.geometry,name=excluded.name,location=excluded.location,
      quality=excluded.quality,coverage=excluded.coverage,country=excluded.country,osm_id=excluded.osm_id,updated_at=now(),map_status='unreviewed',flagged=false
      where courses.source not in ('built-in','user');
  select geometry || jsonb_build_object('mapStatus',map_status,'course',(geometry->'course')||jsonb_build_object('id',id,'uuid',course_uuid,'revisionId',current_revision))
    into result from public.courses where id=p_course->>'id';
  return result;
end $$;
revoke all on function public.publish_osm_course(jsonb) from public,anon,authenticated;
grant execute on function public.publish_osm_course(jsonb) to service_role;
