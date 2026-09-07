alter table public.profiles enable row level security;
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.invitations enable row level security;
alter table public.fx_rates enable row level security;
alter table public.proposals enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.investments enable row level security;
alter table public.investment_valuations enable row level security;
alter table public.audit_logs enable row level security;

create policy profile_self_read on public.profiles for select using (id = auth.uid());
create policy profile_self_update on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy household_read on public.households for select using (public.is_household_member(id));
create policy member_read on public.household_members for select using (public.is_household_member(household_id));
create policy invitation_read on public.invitations for select using (public.is_household_member(household_id));
create policy fx_read on public.fx_rates for select using (public.is_household_member(household_id));
create policy proposal_read on public.proposals for select using (public.is_household_member(household_id));
create policy entry_read on public.ledger_entries for select using (public.is_household_member(household_id));
create policy investment_read on public.investments for select using (public.is_household_member(household_id));
create policy valuation_read on public.investment_valuations for select using (public.is_household_member(household_id));
create policy audit_read on public.audit_logs for select using (public.is_household_member(household_id));

create or replace function public.create_household(household_name text, reporting_currency_input text default 'USD') returns uuid language plpgsql security definer set search_path = public as $$
declare household_uuid uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if reporting_currency_input not in ('USD','CNY','HKD') then raise exception 'invalid currency'; end if;
  insert into public.households(name, reporting_currency, created_by) values (household_name, reporting_currency_input, auth.uid()) returning id into household_uuid;
  insert into public.household_members(household_id, user_id, role) values (household_uuid, auth.uid(), 'owner');
  insert into public.audit_logs(household_id, actor_id, action, entity_type, entity_id) values (household_uuid, auth.uid(), 'create', 'household', household_uuid);
  return household_uuid;
end; $$;

create or replace function public.submit_proposal(target_household uuid, payload_input jsonb, request_key uuid) returns uuid language plpgsql security definer set search_path = public as $$
declare proposal_uuid uuid;
begin
  if not public.is_household_member(target_household) then raise exception 'not authorized'; end if;
  if payload_input->>'type' not in ('deposit','expense','expense_refund','reimbursement','settlement','investment_buy','investment_sell','dividend','investment_valuation') then raise exception 'invalid type'; end if;
  if coalesce((payload_input->>'amountMinor')::bigint, 0) <= 0 and payload_input->>'type' <> 'investment_valuation' then raise exception 'invalid amount'; end if;
  insert into public.proposals(household_id, submitter_id, payload, idempotency_key) values (target_household, auth.uid(), payload_input, request_key) returning id into proposal_uuid;
  insert into public.audit_logs(household_id, actor_id, action, entity_type, entity_id) values (target_household, auth.uid(), 'submit', 'proposal', proposal_uuid);
  return proposal_uuid;
exception when unique_violation then
  select id into proposal_uuid from public.proposals where household_id = target_household and submitter_id = auth.uid() and idempotency_key = request_key;
  return proposal_uuid;
end; $$;

create or replace function public.decide_proposal(proposal_uuid uuid, approve boolean, note text default null) returns uuid language plpgsql security definer set search_path = public as $$
declare p public.proposals; entry_uuid uuid; payload_type text;
begin
  select * into p from public.proposals where id = proposal_uuid for update;
  if p.id is null or not public.is_household_member(p.household_id) then raise exception 'not authorized'; end if;
  if p.submitter_id = auth.uid() then raise exception 'submitter cannot decide own proposal'; end if;
  if p.status not in ('pending_approval','overdue_pending') then raise exception 'proposal is not reviewable'; end if;
  if not approve then
    update public.proposals set status = 'rejected', decided_at = now(), decided_by = auth.uid(), decision_note = note where id = p.id;
    insert into public.audit_logs(household_id, actor_id, action, entity_type, entity_id, detail) values (p.household_id, auth.uid(), 'reject', 'proposal', p.id, jsonb_build_object('note', note));
    return null;
  end if;
  payload_type := p.payload->>'type';
  update public.proposals set status = 'approved', decided_at = now(), decided_by = auth.uid(), decision_note = note where id = p.id;
  if payload_type = 'investment_valuation' then
    insert into public.investment_valuations(household_id, investment_id, proposal_id, value_date, unit_value_minor, currency, note, created_by)
    values (p.household_id, (p.payload->>'investmentId')::uuid, (p.id), (p.payload->>'occurredAt')::date, (p.payload->>'unitValueMinor')::bigint, p.payload->>'currency', p.payload->>'title', p.submitter_id);
  else
    insert into public.ledger_entries(household_id, proposal_id, entry_type, amount_minor, currency, occurred_at, title, category, member_id, investment_id, quantity_milli, unit_price_minor)
    values (p.household_id, p.id, payload_type, (p.payload->>'amountMinor')::bigint, p.payload->>'currency', (p.payload->>'occurredAt')::date, p.payload->>'title', p.payload->>'category', p.submitter_id, nullif(p.payload->>'investmentId','')::uuid, nullif(p.payload->>'quantityMilli','')::bigint, nullif(p.payload->>'unitPriceMinor','')::bigint) returning id into entry_uuid;
  end if;
  insert into public.audit_logs(household_id, actor_id, action, entity_type, entity_id) values (p.household_id, auth.uid(), 'approve', 'proposal', p.id);
  return entry_uuid;
end; $$;
revoke all on function public.create_household(text,text) from public;
revoke all on function public.submit_proposal(uuid,jsonb,uuid) from public;
revoke all on function public.decide_proposal(uuid,boolean,text) from public;
grant execute on function public.create_household(text,text) to authenticated;
grant execute on function public.submit_proposal(uuid,jsonb,uuid) to authenticated;
grant execute on function public.decide_proposal(uuid,boolean,text) to authenticated;
