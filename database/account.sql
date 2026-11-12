-- Delete an active account and its cascading workspace data in one transaction.
create or replace function public.reliefops_delete_account(
    server_key text, actor_id uuid, auth_session_id uuid, confirmation_email text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare current_email text;
begin
    if not exists (select 1 from reliefops_private.server_credential c
        where c.key_hash = encode(extensions.digest(server_key, 'sha256'), 'hex')) then
        raise exception 'Server credential required' using errcode = '42501';
    end if;
    select u.email into current_email from auth.users u where u.id = actor_id for update;
    if not found or not exists (select 1 from auth.sessions s where s.id = auth_session_id and s.user_id = actor_id) then
        raise exception 'Active account session required' using errcode = '42501';
    end if;
    if current_email is null or lower(trim(confirmation_email)) is distinct from lower(current_email) then
        raise exception 'Account confirmation does not match' using errcode = '22023';
    end if;

    -- Every gateway write locks its operation before beginning an external PayPal action.
    perform o.id from public.operations o where o.owner_id = actor_id order by o.id for update;
    if exists (
        select 1 from public.operation_finance f cross join lateral jsonb_array_elements(f.state->'purchases') p
        where f.owner_id = actor_id
          and p->>'status' in ('creating','awaiting_approval','capturing','unknown','review','refunding','refund_unknown')
    ) then
        raise exception 'A PayPal transaction is still unresolved' using errcode = '55000';
    end if;

    delete from auth.users u where u.id = actor_id;
    return jsonb_build_object('deleted', true);
end;
$$;
revoke all on function public.reliefops_delete_account(text,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.reliefops_delete_account(text,uuid,uuid,text) to service_role;
