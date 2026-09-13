-- pg_column_size is STABLE; the policy helper must not promise immutability.
alter function public.valid_course_candidate(jsonb) stable;
