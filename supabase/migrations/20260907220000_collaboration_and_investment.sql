-- Collaboration, invitation, investment validation, and realtime.
alter table public.invitations add column if not exists status text not null default 'pending' check (status in ('pending','accepted','revoked','expired'));
alter table public.invitations add column if not exists accepted_by uuid references public.profiles(id);
alter table public.invitations add column if not exists revoked_at timestamptz;
alter table public.invitations add column if not exists created_at timestamptz not null default now();
alter table public.investments add column if not exists opening_date date not null default current_date;
alter table public.investments add column if not exists archived_at timestamptz;
create index if not exists proposals_household_status_idx on public.proposals(household_id,status,submitted_at desc);
create index if not exists entries_household_date_idx on public.ledger_entries(household_id,occurred_at desc);
create index if not exists entries_investment_date_idx on public.ledger_entries(investment_id,occurred_at,created_at);
create index if not exists invites_token_idx on public.invitations(token_hash) where status = 'pending';

create or replace function public.is_household_owner(target_household uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.household_members where household_id=target_household and user_id=auth.uid() and active and role='owner');
$$;

create or replace function public.create_invitation(target_household uuid, invited_email_input text) returns text language plpgsql security definer set search_path = public as $$
declare token text; normalized text := lower(trim(invited_email_input));
begin
 if not public.is_household_owner(target_household) then raise exception 'owner permission required'; end if;
 if (select count(*) from public.household_members where household_id=target_household and active) >= 2 then raise exception 'household already has two active members'; end if;
 if normalized !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid email'; end if;
 if exists(select 1 from public.invitations where household_id=target_household and lower(email)=normalized and status='pending' and expires_at > now()) then raise exception 'an active invitation already exists for this email'; end if;
 token := encode(gen_random_bytes(32),'hex');
 insert into public.invitations(household_id,email,token_hash,expires_at,invited_by) values(target_household,normalized,encode(digest(token,'sha256'),'hex'),now()+interval '7 days',auth.uid());
 insert into public.audit_logs(household_id,actor_id,action,entity_type,detail) values(target_household,auth.uid(),'create','invitation',jsonb_build_object('email',normalized));
 return token;
end; $$;

create or replace function public.accept_invitation(raw_token text) returns uuid language plpgsql security definer set search_path = public as $$
declare inv public.invitations; user_email text; household_uuid uuid;
begin
 if auth.uid() is null then raise exception 'not authenticated'; end if;
 select lower(email) into user_email from auth.users where id=auth.uid();
 select * into inv from public.invitations where token_hash=encode(digest(raw_token,'sha256'),'hex') for update;
 if inv.id is null or inv.status <> 'pending' or inv.expires_at <= now() then raise exception 'invitation is invalid or expired'; end if;
 if lower(inv.email) <> user_email then raise exception 'invitation email does not match signed-in account'; end if;
 if (select count(*) from public.household_members where household_id=inv.household_id and active) >= 2 then raise exception 'household already has two active members'; end if;
 if exists(select 1 from public.household_members where household_id=inv.household_id and user_id=auth.uid()) then raise exception 'already a member'; end if;
 insert into public.household_members(household_id,user_id,role) values(inv.household_id,auth.uid(),'member');
 update public.invitations set status='accepted',accepted_at=now(),accepted_by=auth.uid() where id=inv.id;
 insert into public.audit_logs(household_id,actor_id,action,entity_type,entity_id) values(inv.household_id,auth.uid(),'accept','invitation',inv.id);
 return inv.household_id;
end; $$;

create or replace function public.create_investment_proposal(target_household uuid, payload_input jsonb, request_key uuid) returns uuid language plpgsql security definer set search_path=public as $$
declare proposal_uuid uuid;
begin
 if not public.is_household_member(target_household) then raise exception 'not authorized'; end if;
 if coalesce(payload_input->>'name','')='' or payload_input->>'currency' not in ('USD','CNY','HKD') then raise exception 'invalid investment'; end if;
 insert into public.proposals(household_id,submitter_id,payload,idempotency_key) values(target_household,auth.uid(),jsonb_build_object('type','investment_create','amountMinor',0,'currency',payload_input->>'currency','occurredAt',payload_input->>'occurredAt','title',payload_input->>'name','investment',payload_input),request_key) returning id into proposal_uuid;
 insert into public.audit_logs(household_id,actor_id,action,entity_type,entity_id) values(target_household,auth.uid(),'submit','proposal',proposal_uuid);
 return proposal_uuid;
end; $$;

create or replace function public.current_investment_quantity(target_investment uuid) returns bigint language sql stable security definer set search_path=public as $$
 select i.opening_quantity_milli + coalesce(sum(case when e.entry_type='investment_buy' then e.quantity_milli when e.entry_type='investment_sell' then -e.quantity_milli else 0 end),0)
 from public.investments i left join public.ledger_entries e on e.investment_id=i.id and e.status='posted' where i.id=target_investment group by i.id;
$$;

create or replace function public.decide_proposal(proposal_uuid uuid, approve boolean, note text default null) returns uuid language plpgsql security definer set search_path = public as $$
declare p public.proposals; entry_uuid uuid; payload_type text; inv public.investments; amount bigint; quantity bigint; unit_price bigint;
begin
 select * into p from public.proposals where id=proposal_uuid for update;
 if p.id is null or not public.is_household_member(p.household_id) then raise exception 'not authorized'; end if;
 if p.submitter_id=auth.uid() then raise exception 'submitter cannot decide own proposal'; end if;
 if p.status not in ('pending_approval','overdue_pending') then raise exception 'proposal is not reviewable'; end if;
 if not approve then update public.proposals set status='rejected',decided_at=now(),decided_by=auth.uid(),decision_note=note where id=p.id; return null; end if;
 payload_type:=p.payload->>'type';
 if payload_type='investment_create' then
   insert into public.investments(household_id,name,ticker,asset_type,currency,opening_quantity_milli,opening_cost_minor,opening_date) values(p.household_id,p.payload->'investment'->>'name',p.payload->'investment'->>'ticker',coalesce(p.payload->'investment'->>'assetType','other'),p.payload->'investment'->>'currency',coalesce((p.payload->'investment'->>'openingQuantityMilli')::bigint,0),coalesce((p.payload->'investment'->>'openingCostMinor')::bigint,0),(p.payload->>'occurredAt')::date) returning id into entry_uuid;
 elsif payload_type='investment_valuation' then
   select * into inv from public.investments where id=(p.payload->>'investmentId')::uuid and household_id=p.household_id for update;
   if inv.id is null then raise exception 'investment not found'; end if;
   insert into public.investment_valuations(household_id,investment_id,proposal_id,value_date,unit_value_minor,currency,note,created_by) values(p.household_id,inv.id,p.id,(p.payload->>'occurredAt')::date,(p.payload->>'unitValueMinor')::bigint,p.payload->>'currency',p.payload->>'title',p.submitter_id) returning id into entry_uuid;
 else
   amount:=(p.payload->>'amountMinor')::bigint;
   if amount <= 0 then raise exception 'invalid amount'; end if;
   if payload_type in ('investment_buy','investment_sell','dividend') then
     select * into inv from public.investments where id=(p.payload->>'investmentId')::uuid and household_id=p.household_id for update;
     if inv.id is null then raise exception 'investment not found'; end if;
     if inv.currency <> p.payload->>'currency' then raise exception 'investment currency mismatch'; end if;
     if payload_type in ('investment_buy','investment_sell') then quantity:=(p.payload->>'quantityMilli')::bigint; unit_price:=(p.payload->>'unitPriceMinor')::bigint; if quantity<=0 or unit_price<=0 then raise exception 'invalid investment trade'; end if; end if;
     if payload_type='investment_sell' and quantity > public.current_investment_quantity(inv.id) then raise exception 'sell quantity exceeds confirmed holding'; end if;
   end if;
   insert into public.ledger_entries(household_id,proposal_id,entry_type,amount_minor,currency,occurred_at,title,category,member_id,investment_id,quantity_milli,unit_price_minor) values(p.household_id,p.id,payload_type,amount,p.payload->>'currency',(p.payload->>'occurredAt')::date,p.payload->>'title',p.payload->>'category',p.submitter_id,nullif(p.payload->>'investmentId','')::uuid,nullif(p.payload->>'quantityMilli','')::bigint,nullif(p.payload->>'unitPriceMinor','')::bigint) returning id into entry_uuid;
 end if;
 update public.proposals set status='approved',decided_at=now(),decided_by=auth.uid(),decision_note=note where id=p.id;
 insert into public.audit_logs(household_id,actor_id,action,entity_type,entity_id) values(p.household_id,auth.uid(),'approve','proposal',p.id);
 return entry_uuid;
end; $$;
grant execute on function public.create_invitation(uuid,text),public.accept_invitation(text),public.create_investment_proposal(uuid,jsonb,uuid),public.current_investment_quantity(uuid) to authenticated;
alter publication supabase_realtime add table public.proposals,public.ledger_entries,public.investments,public.investment_valuations,public.household_members,public.fx_rates;
