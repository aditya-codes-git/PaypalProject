-- Owners may delete one operation. Every delete checks payment state while
-- holding the same operation row lock used by financial gateway writes.
create function public.guard_operation_deletion() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
    if exists (
        select 1 from public.operation_finance f cross join lateral jsonb_array_elements(f.state->'purchases') p
        where f.operation_id = old.id and f.owner_id = old.owner_id
          and p->>'status' in ('creating','awaiting_approval','capturing','unknown','review','refunding','refund_unknown')
    ) then
        raise exception 'A PayPal transaction is still unresolved' using errcode = '55000';
    end if;
    return old;
end;
$$;
revoke all on function public.guard_operation_deletion() from public, anon, authenticated;
create trigger guard_operation_deletion before delete on public.operations
    for each row when (current_user = 'authenticated')
    execute function public.guard_operation_deletion();

grant delete on public.operations to authenticated;
create policy operations_delete_owner on public.operations for delete to authenticated
    using ((select auth.uid()) = owner_id);
