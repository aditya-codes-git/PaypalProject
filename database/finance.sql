-- Additive migration. Existing operations and calculation snapshots are preserved.
-- Financial writes are server-only; a scoped server credential is provisioned separately.
create schema if not exists reliefops_private;
revoke all on schema reliefops_private from public, anon, authenticated;
create table reliefops_private.server_credential (
    singleton boolean primary key default true check (singleton),
    key_hash text not null
);
revoke all on reliefops_private.server_credential from public, anon, authenticated;
create table reliefops_private.ai_daily_usage (day date primary key, requests integer not null);
revoke all on reliefops_private.ai_daily_usage from public, anon, authenticated;

create table public.operation_finance (
    operation_id uuid primary key references public.operations(id) on delete cascade,
    owner_id uuid not null references auth.users(id) on delete cascade,
    version integer not null default 1,
    state jsonb not null check (jsonb_typeof(state) = 'object' and octet_length(state::text) <= 2000000),
    updated_at timestamptz not null default now()
);
create index operation_finance_owner_idx on public.operation_finance(owner_id);
alter table public.operation_finance enable row level security;
revoke all on public.operation_finance from public, anon, authenticated;
grant select on public.operation_finance to authenticated;
create policy finance_read_owner on public.operation_finance for select to authenticated
    using ((select auth.uid()) = owner_id);

-- A single-operation compare-and-swap serializes approval/reservation/payment transitions.
-- No provider HTTP call is made while a database lock is held.
create function public.reliefops_finance_command(
    server_key text, command text, op_id uuid default null, actor_id uuid default null,
    expected_version integer default null, expected_revision integer default null,
    new_state jsonb default null, order_id text default null, updated_scenario jsonb default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare op public.operations; row public.operation_finance; result jsonb; used integer;
begin
    if not exists (select 1 from reliefops_private.server_credential c
        where c.key_hash = encode(extensions.digest(server_key, 'sha256'), 'hex')) then
        raise exception 'Server credential required' using errcode = '42501';
    end if;
    if command = 'ai_budget' then
        insert into reliefops_private.ai_daily_usage(day, requests) values (current_date, 1)
        on conflict (day) do update set requests = reliefops_private.ai_daily_usage.requests + 1
        returning requests into used;
        if used > 20 then raise exception 'Daily AI evaluation budget exhausted' using errcode = '53000'; end if;
        return jsonb_build_object('requests', used, 'daily_limit', 20);
    end if;
    if command = 'lookup' then
        select jsonb_build_object('operation_id', f.operation_id, 'owner_id', f.owner_id)
        into result from public.operation_finance f
        where exists (select 1 from jsonb_array_elements(f.state->'purchases') p where p->>'order_id' = order_id or p->>'capture_id' = order_id or p->>'refund_id' = order_id)
        limit 1;
        return result;
    end if;
    if command = 'pending' then
        select coalesce(jsonb_agg(t), '[]'::jsonb) into result from (
            select f.operation_id, f.owner_id, p->>'id' as purchase_id
            from public.operation_finance f cross join lateral jsonb_array_elements(f.state->'purchases') p
            where coalesce((p->>'last_reconciled_at')::timestamptz, (p->>'submitted_at')::timestamptz, (p->>'created_at')::timestamptz) < now() - interval '60 seconds'
              and p->>'status' in ('creating','capturing','unknown','refunding','refund_unknown')
            order by coalesce((p->>'last_reconciled_at')::timestamptz, (p->>'created_at')::timestamptz) limit 10
        ) t;
        return result;
    end if;
    select * into op from public.operations where id = op_id and owner_id = actor_id for update;
    if not found then raise exception 'Operation not found' using errcode = 'P0002'; end if;
    select * into row from public.operation_finance where operation_id = op_id;
    if command = 'read' then
        return jsonb_build_object('version', coalesce(row.version, 0), 'state', row.state, 'operation', to_jsonb(op));
    end if;
    if command <> 'write' or new_state is null then raise exception 'Invalid command'; end if;
    if op.revision <> expected_revision or coalesce(row.version, 0) <> expected_version then
        raise exception 'Operation changed; reload and retry' using errcode = '40001';
    end if;
    if updated_scenario is not null then
        update public.operations set scenario = updated_scenario where id = op_id returning * into op;
    end if;
    insert into public.operation_finance(operation_id, owner_id, version, state)
        values (op_id, actor_id, 1, new_state)
    on conflict (operation_id) do update set state = excluded.state,
        version = public.operation_finance.version + 1, updated_at = now();
    return jsonb_build_object('version', coalesce(row.version, 0) + 1, 'state', new_state, 'operation', to_jsonb(op));
end;
$$;
revoke all on function public.reliefops_finance_command(text,text,uuid,uuid,integer,integer,jsonb,text,jsonb) from public, anon, authenticated;
-- Only the gateway Edge Function's platform-provided service credential can reach this RPC.
grant execute on function public.reliefops_finance_command(text,text,uuid,uuid,integer,integer,jsonb,text,jsonb) to service_role;
comment on function public.reliefops_finance_command(text,text,uuid,uuid,integer,integer,jsonb,text,jsonb) is
    'Backend-only application gateway: requires scoped secret, checks owner, serializes operation transitions. Never expose the server key to clients.';
