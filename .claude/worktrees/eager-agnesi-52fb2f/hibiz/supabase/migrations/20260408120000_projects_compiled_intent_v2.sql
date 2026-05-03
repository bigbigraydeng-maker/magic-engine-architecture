-- Optional JSON storage for HiBiz v0.4 hybrid compiler output (CompiledIntentV2)

alter table public.projects
add column if not exists compiled_intent_v2 jsonb;

comment on column public.projects.compiled_intent_v2 is 'v0.4 hybrid compiler: CompiledIntentV2 snapshot after user confirm (optional).';
