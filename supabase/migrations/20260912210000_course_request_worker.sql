-- Only the worker controls job state. Keep guest requests supported.
alter table public.course_requests
  add column lease_token uuid,
  add column lease_expires_at timestamptz,
  add column next_attempt_at timestamptz not null default now();

create or replace function public.valid_course_candidate(c jsonb)
returns boolean language plpgsql immutable set search_path = public as $$
begin
  if c is null or jsonb_typeof(c) <> 'object' then return false; end if;
  return coalesce(
    c->>'provider' = 'osm' and c->>'osmType' in ('node','way','relation')
    and jsonb_typeof(c->'osmId') = 'number'
    and (c->>'osmId')::numeric between 1 and 9007199254740991
    and (c->>'osmId')::numeric = trunc((c->>'osmId')::numeric)
    and c->>'id' = 'osm-' || (c->>'osmType') || '-' || (c->>'osmId')
    and jsonb_typeof(c->'lat') = 'number' and (c->>'lat')::numeric between -90 and 90
    and jsonb_typeof(c->'lon') = 'number' and (c->>'lon')::numeric between -180 and 180
    and jsonb_typeof(c->'name') = 'string' and length(trim(c->>'name')) between 1 and 300
    and (not c ? 'layout' or (jsonb_typeof(c->'layout') = 'string' and length(trim(c->>'layout')) between 1 and 200))
    and pg_column_size(c) < 8192, false);
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end $$;

drop policy "anyone can request a course" on public.course_requests;
create policy "valid course requests" on public.course_requests
  for insert to anon, authenticated with check (
    public.valid_course_candidate(candidate)
    and name = candidate->>'name' and length(trim(name)) between 1 and 300
    and (place is null or length(place) <= 500)
    and requested_by is not distinct from auth.uid()
    and status = 'pending' and attempts = 0 and course_id is null and error is null
    and lease_token is null and lease_expires_at is null
  );
revoke insert, update, delete on public.course_requests from anon, authenticated;
grant insert (name, place, candidate, requested_by) on public.course_requests to anon, authenticated;
-- Status is shared; the requester's account ID is not part of the public status API.
revoke select on public.course_requests from anon, authenticated;
grant select (id, name, place, candidate, status, course_id, error, attempts, created_at, updated_at)
  on public.course_requests to anon, authenticated;

create trigger course_requests_touch before update on public.course_requests
  for each row execute function public.touch_updated_at();

-- One job per claim, with server-clock leases and bounded recovery after crashes.
create or replace function public.claim_course_request()
returns setof public.course_requests language plpgsql set search_path = public as $$
begin
  update public.course_requests set status = case when attempts >= 3 then 'failed' else 'pending' end,
    error = 'Mapping worker was interrupted. Please try again.', lease_token = null, lease_expires_at = null
    where status = 'building' and coalesce(lease_expires_at, updated_at + interval '10 minutes') < now();
  return query
    update public.course_requests r set status = 'building', attempts = r.attempts + 1,
      lease_token = gen_random_uuid(), lease_expires_at = now() + interval '10 minutes'
    where r.id = (select q.id from public.course_requests q
      where q.status = 'pending' and q.next_attempt_at <= now() and q.attempts < 3
      order by q.created_at, q.id for update skip locked limit 1)
    returning r.*;
end $$;

-- Publication and completion share the same lease check and transaction. A late
-- result from an expired worker can never overwrite the new worker's catalogue.
create or replace function public.finish_course_request(
  p_id bigint, p_lease uuid, p_course jsonb default null, p_error text default null, p_retry boolean default true
) returns boolean language plpgsql set search_path = public as $$
declare job public.course_requests;
begin
  select * into job from public.course_requests where id = p_id and status = 'building'
    and lease_token = p_lease and lease_expires_at > now() for update;
  if not found then return false; end if;
  if p_course is not null then
    insert into public.courses (id, name, location, geometry, source, quality, coverage, country, osm_id)
      values (p_course->>'id', p_course->>'name', p_course->>'location', p_course->'geometry', 'osm',
        p_course->>'quality', p_course->'coverage', p_course->>'country', (p_course->>'osm_id')::bigint)
      on conflict (id) do update set name = excluded.name, location = excluded.location,
        geometry = excluded.geometry, quality = excluded.quality, coverage = excluded.coverage,
        country = excluded.country, osm_id = excluded.osm_id, updated_at = now()
      where courses.source not in ('built-in','user');
    update public.course_requests set status = 'done', course_id = p_course->>'id', error = null,
      lease_token = null, lease_expires_at = null where id = p_id;
  else
    update public.course_requests set status = case when p_retry and job.attempts < 3 then 'pending' else 'failed' end,
      error = left(coalesce(p_error, 'Mapping could not be completed.'), 200),
      next_attempt_at = now() + make_interval(secs => 60 * job.attempts),
      lease_token = null, lease_expires_at = null where id = p_id;
  end if;
  return true;
end $$;

revoke all on function public.claim_course_request() from public, anon, authenticated;
revoke all on function public.finish_course_request(bigint, uuid, jsonb, text, boolean) from public, anon, authenticated;
grant execute on function public.claim_course_request() to service_role;
grant execute on function public.finish_course_request(bigint, uuid, jsonb, text, boolean) to service_role;
