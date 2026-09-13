-- Queryable position for the course finder ("near me", map bounds, globe layer).
-- Generated from the geometry JSON so the pre-build pipeline needs no change.
alter table public.courses
  add column if not exists lat double precision generated always as ((geometry->'course'->>'lat')::double precision) stored,
  add column if not exists lon double precision generated always as ((geometry->'course'->>'lon')::double precision) stored;
create index if not exists courses_lat_lon_idx on public.courses (lat, lon);
