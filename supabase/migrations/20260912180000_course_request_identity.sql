-- Keep a discovered course's identity through the asynchronous mapping queue.
alter table public.course_requests add column if not exists candidate jsonb;
drop index if exists public.course_requests_open_name_idx;
create unique index course_requests_open_identity_idx
  on public.course_requests ((candidate->>'id'), (coalesce(candidate->>'layout','')))
  where status in ('pending','building') and candidate is not null;
create unique index course_requests_open_legacy_name_idx
  on public.course_requests (lower(name), coalesce(place,''))
  where status in ('pending','building') and candidate is null;
