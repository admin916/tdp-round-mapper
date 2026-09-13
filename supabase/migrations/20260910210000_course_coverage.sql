-- Catalogue pre-build support: how much of each course came from real map/card
-- data (so the finder can be honest about partial courses), plus provenance.
alter table public.courses
  add column if not exists quality    text not null default 'full'
             check (quality in ('full','partial','outline')),
  add column if not exists coverage   jsonb,
  add column if not exists osm_id     bigint,
  add column if not exists country    text,               -- ISO 3166-1 alpha-2
  add column if not exists updated_at timestamptz not null default now();
create index if not exists courses_country_idx on public.courses (country);
create index if not exists courses_quality_idx on public.courses (quality);
