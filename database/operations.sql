-- Applied remotely through Supabase's migration tool as reliefops_operations.
-- Single-owner workspaces are the initial authorization boundary.
create table public.operations (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    name text not null check (length(trim(name)) between 1 and 100),
    scenario jsonb not null check (jsonb_typeof(scenario) = 'object' and octet_length(scenario::text) < 100000),
    revision integer not null default 1 check (revision > 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (id, owner_id)
);
create index operations_owner_updated_idx on public.operations(owner_id, updated_at desc);

create table public.operation_plans (
    id uuid primary key default gen_random_uuid(),
    operation_id uuid not null,
    owner_id uuid not null default auth.uid(),
    input_revision integer not null check (input_revision > 0),
    scenario jsonb not null check (jsonb_typeof(scenario) = 'object' and octet_length(scenario::text) < 100000),
    result jsonb not null check (jsonb_typeof(result) = 'object' and octet_length(result::text) < 100000),
    created_at timestamptz not null default now(),
    foreign key (operation_id, owner_id) references public.operations(id, owner_id) on delete cascade
);
create index operation_plans_owner_operation_created_idx
    on public.operation_plans(owner_id, operation_id, created_at desc);

alter table public.operations enable row level security;
alter table public.operation_plans enable row level security;
revoke all on public.operations, public.operation_plans from anon, authenticated;
grant select, insert on public.operations to authenticated;
grant update (name, scenario) on public.operations to authenticated;
grant select, insert on public.operation_plans to authenticated;

create policy operations_select_owner on public.operations for select to authenticated
    using ((select auth.uid()) = owner_id);
create policy operations_insert_owner on public.operations for insert to authenticated
    with check ((select auth.uid()) = owner_id and revision = 1);
create policy operations_update_owner on public.operations for update to authenticated
    using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy operation_plans_select_owner on public.operation_plans for select to authenticated
    using ((select auth.uid()) = owner_id);
create policy operation_plans_insert_owner on public.operation_plans for insert to authenticated
    with check ((select auth.uid()) = owner_id);

create function public.bump_operation_revision() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
    new.revision := old.revision + 1;
    new.updated_at := now();
    return new;
end;
$$;
revoke all on function public.bump_operation_revision() from public, anon, authenticated;
create trigger bump_operation_revision before update on public.operations
    for each row execute function public.bump_operation_revision();

comment on table public.operation_plans is
    'Saved calculation snapshots, not approved spending instructions. Clients may insert their own records; future payment approval must recompute and independently validate.';
