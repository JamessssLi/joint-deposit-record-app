-- P1 proposal integrity: stable replay order, typed payload validation, and idempotent decisions.
alter table public.ledger_entries add column if not exists effective_sequence bigint;
alter table public.ledger_entries add column if not exists payer_member_id uuid references public.profiles(id);
alter table public.ledger_entries add column if not exists payee_member_id uuid references public.profiles(id);

with ranked as (
  select id, row_number() over (partition by household_id order by occurred_at, created_at, id) as sequence
  from public.ledger_entries
  where effective_sequence is null
)
update public.ledger_entries as entry
set effective_sequence = ranked.sequence
from ranked
where entry.id = ranked.id;

alter table public.ledger_entries alter column effective_sequence set not null;
create unique index if not exists entries_household_sequence_idx on public.ledger_entries(household_id, effective_sequence);
create index if not exists entries_household_replay_idx on public.ledger_entries(household_id, occurred_at, effective_sequence, id);

alter table public.ledger_entries drop constraint if exists ledger_entries_amount_minor_check;
alter table public.ledger_entries add constraint ledger_entries_amount_minor_check
  check ((entry_type = 'investment_sell' and amount_minor >= 0) or (entry_type <> 'investment_sell' and amount_minor > 0));
alter table public.ledger_entries add constraint ledger_entries_trade_quantity_check
  check (entry_type not in ('investment_buy','investment_sell') or (quantity_milli is not null and quantity_milli > 0)) not valid;
alter table public.ledger_entries add constraint ledger_entries_reference_price_check
  check (unit_price_minor is null or unit_price_minor > 0) not valid;

create or replace function public.shares_active_household(target_user uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
  select exists(
    select 1
    from public.household_members mine
    join public.household_members peer on peer.household_id = mine.household_id
    where mine.user_id = auth.uid() and mine.active and peer.user_id = target_user and peer.active
  );
$$;
drop policy if exists profile_household_peer_read on public.profiles;
create policy profile_household_peer_read on public.profiles for select using (public.shares_active_household(id));

create or replace function public.validate_proposal_payload(target_household uuid, payload_input jsonb) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  payload_type text;
  amount bigint;
  quantity bigint;
  reference_price bigint;
  valuation bigint;
  investment_uuid uuid;
begin
  if payload_input is null or jsonb_typeof(payload_input) <> 'object' then raise exception 'invalid payload'; end if;
  if exists(
    select 1 from jsonb_object_keys(payload_input) as payload_key(key)
    where key not in ('type','amountMinor','currency','occurredAt','title','category','investmentId','quantityMilli','unitPriceMinor','unitValueMinor','payerMemberId','payeeMemberId')
  ) then raise exception 'unexpected payload field'; end if;

  if jsonb_typeof(payload_input->'type') is distinct from 'string' then raise exception 'invalid type'; end if;
  if jsonb_typeof(payload_input->'currency') is distinct from 'string' then raise exception 'invalid currency'; end if;
  if jsonb_typeof(payload_input->'occurredAt') is distinct from 'string' then raise exception 'invalid occurrence date'; end if;
  if jsonb_typeof(payload_input->'title') is distinct from 'string' then raise exception 'invalid title'; end if;
  payload_type := payload_input->>'type';
  if payload_type is null or payload_type not in ('deposit','expense','expense_refund','reimbursement','settlement','investment_buy','investment_sell','dividend','investment_valuation') then raise exception 'invalid type'; end if;
  if payload_input->>'currency' is null or payload_input->>'currency' not in ('USD','CNY','HKD') then raise exception 'invalid currency'; end if;
  if coalesce(length(trim(payload_input->>'title')), 0) not between 1 and 160 then raise exception 'invalid title'; end if;
  if coalesce(payload_input->>'occurredAt','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'invalid occurrence date'; end if;
  perform (payload_input->>'occurredAt')::date;
  if jsonb_typeof(payload_input->'amountMinor') is distinct from 'number' then raise exception 'amount is required'; end if;
  amount := (payload_input->>'amountMinor')::bigint;
  if amount > 9999999999 then raise exception 'amount exceeds limit'; end if;

  if payload_type = 'investment_valuation' then
    if amount <> 0 then raise exception 'valuation amount must be zero'; end if;
  elsif payload_type = 'investment_sell' then
    if amount < 0 then raise exception 'invalid amount'; end if;
  elsif amount <= 0 then
    raise exception 'invalid amount';
  end if;

  if payload_type in ('expense','reimbursement') and (
    jsonb_typeof(payload_input->'category') is distinct from 'string' or coalesce(length(trim(payload_input->>'category')), 0) not between 1 and 60
  ) then raise exception 'category is required'; end if;
  if payload_input ? 'category' and payload_type not in ('expense','expense_refund','reimbursement') then raise exception 'category is not allowed'; end if;
  if payload_type = 'expense_refund' and payload_input ? 'category' and (
    jsonb_typeof(payload_input->'category') is distinct from 'string' or coalesce(length(trim(payload_input->>'category')), 0) not between 1 and 60
  ) then raise exception 'invalid category'; end if;

  if payload_input ? 'investmentId' and payload_type not in ('investment_buy','investment_sell','dividend','investment_valuation') then raise exception 'investment is not allowed'; end if;
  if payload_input ? 'quantityMilli' and payload_type not in ('investment_buy','investment_sell') then raise exception 'quantity is not allowed'; end if;
  if payload_input ? 'unitPriceMinor' and payload_type not in ('investment_buy','investment_sell') then raise exception 'reference price is not allowed'; end if;
  if payload_input ? 'unitValueMinor' and payload_type <> 'investment_valuation' then raise exception 'valuation is not allowed'; end if;
  if payload_input ? 'payerMemberId' and payload_type <> 'reimbursement' then raise exception 'payer is not allowed'; end if;
  if payload_input ? 'payeeMemberId' and payload_type <> 'settlement' then raise exception 'payee is not allowed'; end if;

  if payload_type in ('investment_buy','investment_sell','dividend','investment_valuation') then
    if jsonb_typeof(payload_input->'investmentId') is distinct from 'string' or coalesce(payload_input->>'investmentId','') = '' then raise exception 'investment is required'; end if;
    investment_uuid := (payload_input->>'investmentId')::uuid;
    if not exists(select 1 from public.investments where id=investment_uuid and household_id=target_household and archived_at is null) then raise exception 'investment not found'; end if;
  end if;

  if payload_type in ('investment_buy','investment_sell') then
    if jsonb_typeof(payload_input->'quantityMilli') is distinct from 'number' then raise exception 'quantity is required'; end if;
    quantity := (payload_input->>'quantityMilli')::bigint;
    if quantity <= 0 or quantity > 9999999999999 then raise exception 'invalid quantity'; end if;
    if payload_input ? 'unitPriceMinor' then
      if jsonb_typeof(payload_input->'unitPriceMinor') is distinct from 'number' then raise exception 'invalid reference price'; end if;
      reference_price := (payload_input->>'unitPriceMinor')::bigint;
      if reference_price <= 0 or reference_price > 9999999999 then raise exception 'invalid reference price'; end if;
    end if;
  end if;

  if payload_type = 'investment_valuation' then
    if jsonb_typeof(payload_input->'unitValueMinor') is distinct from 'number' then raise exception 'valuation is required'; end if;
    valuation := (payload_input->>'unitValueMinor')::bigint;
    if valuation <= 0 or valuation > 9999999999 then raise exception 'invalid valuation'; end if;
  end if;

  if payload_input ? 'payerMemberId' and (
    jsonb_typeof(payload_input->'payerMemberId') is distinct from 'string' or not exists(
    select 1 from public.household_members where household_id=target_household and user_id=(payload_input->>'payerMemberId')::uuid and active
  )) then raise exception 'payer is not an active household member'; end if;
  if payload_input ? 'payeeMemberId' and (
    jsonb_typeof(payload_input->'payeeMemberId') is distinct from 'string' or not exists(
    select 1 from public.household_members where household_id=target_household and user_id=(payload_input->>'payeeMemberId')::uuid and active
  )) then raise exception 'payee is not an active household member'; end if;
end;
$$;

create or replace function public.submit_proposal(target_household uuid, payload_input jsonb, request_key uuid) returns uuid
language plpgsql security definer set search_path=pg_catalog,public as $$
declare proposal_uuid uuid;
begin
  if request_key is null then raise exception 'idempotency key is required'; end if;
  perform public.require_active_household(target_household);
  perform public.validate_proposal_payload(target_household, payload_input);

  insert into public.proposals(household_id, submitter_id, payload, idempotency_key)
  values(target_household, auth.uid(), payload_input, request_key)
  on conflict (household_id, submitter_id, idempotency_key) do nothing
  returning id into proposal_uuid;

  if proposal_uuid is null then
    select id into proposal_uuid from public.proposals
    where household_id=target_household and submitter_id=auth.uid() and idempotency_key=request_key;
  else
    insert into public.audit_logs(household_id, actor_id, action, entity_type, entity_id)
    values(target_household, auth.uid(), 'submit', 'proposal', proposal_uuid);
  end if;
  return proposal_uuid;
end;
$$;

create or replace function public.decide_proposal(proposal_uuid uuid, approve boolean, note text default null) returns uuid
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  p public.proposals;
  inv public.investments;
  entry_uuid uuid;
  payload_type text;
  amount bigint;
  quantity bigint;
  next_sequence bigint;
begin
  select * into p from public.proposals where id=proposal_uuid for update;
  if p.id is null or not public.is_household_member(p.household_id) then raise exception 'not authorized'; end if;
  if p.submitter_id=auth.uid() then raise exception 'submitter cannot decide own proposal'; end if;
  if approve is null then raise exception 'decision is required'; end if;

  if p.status='approved' and approve then
    select id into entry_uuid from public.ledger_entries where proposal_id=p.id;
    if entry_uuid is null then select id into entry_uuid from public.investment_valuations where proposal_id=p.id; end if;
    return entry_uuid;
  end if;
  if p.status='rejected' and not approve then return null; end if;
  if p.status not in ('pending_approval','overdue_pending') then raise exception 'proposal is not reviewable'; end if;

  if not approve then
    update public.proposals set status='rejected', decided_at=now(), decided_by=auth.uid(), decision_note=note where id=p.id;
    insert into public.audit_logs(household_id, actor_id, action, entity_type, entity_id, detail)
    values(p.household_id, auth.uid(), 'reject', 'proposal', p.id, jsonb_build_object('note', note));
    return null;
  end if;

  perform 1 from public.households where id=p.household_id and status='active' for update;
  if not found then raise exception 'household is archived'; end if;
  perform public.validate_proposal_payload(p.household_id, p.payload);
  if (p.payload->>'occurredAt')::date > current_date then raise exception 'future entries cannot be posted'; end if;

  payload_type := p.payload->>'type';
  if payload_type in ('investment_buy','investment_sell','dividend','investment_valuation') then
    select * into inv from public.investments
    where id=(p.payload->>'investmentId')::uuid and household_id=p.household_id and archived_at is null
    for update;
    if inv.id is null then raise exception 'investment not found'; end if;
    if inv.currency <> p.payload->>'currency' then raise exception 'investment currency mismatch'; end if;
  end if;

  if payload_type='investment_valuation' then
    insert into public.investment_valuations(household_id,investment_id,proposal_id,value_date,unit_value_minor,currency,note,created_by)
    values(p.household_id,inv.id,p.id,(p.payload->>'occurredAt')::date,(p.payload->>'unitValueMinor')::bigint,p.payload->>'currency',p.payload->>'title',p.submitter_id)
    returning id into entry_uuid;
  else
    amount := (p.payload->>'amountMinor')::bigint;
    if payload_type in ('investment_buy','investment_sell') then
      quantity := (p.payload->>'quantityMilli')::bigint;
      if payload_type='investment_sell' and quantity > public.current_investment_quantity(inv.id) then raise exception 'sell quantity exceeds confirmed holding'; end if;
    end if;
    select coalesce(max(effective_sequence),0)+1 into next_sequence from public.ledger_entries where household_id=p.household_id;
    insert into public.ledger_entries(
      household_id,proposal_id,entry_type,amount_minor,currency,occurred_at,effective_sequence,title,category,
      member_id,payer_member_id,payee_member_id,investment_id,quantity_milli,unit_price_minor
    ) values (
      p.household_id,p.id,payload_type,amount,p.payload->>'currency',(p.payload->>'occurredAt')::date,next_sequence,p.payload->>'title',p.payload->>'category',
      p.submitter_id,nullif(p.payload->>'payerMemberId','')::uuid,nullif(p.payload->>'payeeMemberId','')::uuid,
      nullif(p.payload->>'investmentId','')::uuid,nullif(p.payload->>'quantityMilli','')::bigint,nullif(p.payload->>'unitPriceMinor','')::bigint
    ) returning id into entry_uuid;
  end if;

  update public.proposals set status='approved', decided_at=now(), decided_by=auth.uid(), decision_note=note where id=p.id;
  insert into public.audit_logs(household_id,actor_id,action,entity_type,entity_id)
  values(p.household_id,auth.uid(),'approve','proposal',p.id);
  return entry_uuid;
end;
$$;

revoke all on function public.shares_active_household(uuid) from public;
revoke all on function public.validate_proposal_payload(uuid,jsonb) from public;
revoke all on function public.submit_proposal(uuid,jsonb,uuid) from public;
revoke all on function public.decide_proposal(uuid,boolean,text) from public;
grant execute on function public.shares_active_household(uuid) to authenticated;
grant execute on function public.submit_proposal(uuid,jsonb,uuid) to authenticated;
grant execute on function public.decide_proposal(uuid,boolean,text) to authenticated;
