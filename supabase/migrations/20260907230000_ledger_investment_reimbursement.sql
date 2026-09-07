-- Fix invitation crypto resolution and add lifecycle, direct prices, and reimbursement allocations.
create extension if not exists pgcrypto with schema extensions;
alter table public.households add column if not exists status text not null default 'active' check (status in ('active','archived'));
alter table public.households add column if not exists archived_at timestamptz, add column if not exists archived_by uuid references public.profiles(id), add column if not exists archive_reason text;
alter table public.ledger_entries add column if not exists voided_at timestamptz, add column if not exists voided_by uuid references public.profiles(id), add column if not exists void_reason text;
alter table public.investments add column if not exists created_by uuid references public.profiles(id), add column if not exists latest_price_minor bigint, add column if not exists latest_price_updated_at timestamptz, add column if not exists latest_price_updated_by uuid references public.profiles(id);
alter table public.investment_valuations alter column proposal_id drop not null;
alter table public.investment_valuations add column if not exists source text not null default 'approved_proposal';
create table if not exists public.reimbursement_claims (id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade, source_entry_id uuid not null unique references public.ledger_entries(id), claimant_id uuid not null references public.profiles(id), currency text not null check (currency in ('USD','CNY','HKD')), claimed_minor bigint not null check (claimed_minor > 0), status text not null default 'open' check (status in ('open','partially_settled','settled','voided')), created_at timestamptz not null default now());
create table if not exists public.settlement_allocations (id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade, settlement_entry_id uuid not null references public.ledger_entries(id), claim_id uuid not null references public.reimbursement_claims(id), amount_minor bigint not null check (amount_minor > 0), created_at timestamptz not null default now(), unique(settlement_entry_id,claim_id));
create index if not exists claims_member_idx on public.reimbursement_claims(household_id,claimant_id,status,currency);
create index if not exists allocation_claim_idx on public.settlement_allocations(claim_id);
create index if not exists valuation_latest_idx on public.investment_valuations(investment_id,value_date desc,created_at desc);
alter table public.reimbursement_claims enable row level security;
alter table public.settlement_allocations enable row level security;
create policy claims_read on public.reimbursement_claims for select using (public.is_household_member(household_id));
create policy allocations_read on public.settlement_allocations for select using (public.is_household_member(household_id));

create or replace function public.require_active_household(target_household uuid) returns void language plpgsql security definer set search_path=pg_catalog,public as $$ begin if not public.is_household_member(target_household) then raise exception 'not authorized'; end if; if not exists(select 1 from public.households where id=target_household and status='active') then raise exception 'household is archived'; end if; end; $$;
create or replace function public.create_invitation(target_household uuid, invited_email_input text) returns text language plpgsql security definer set search_path=pg_catalog,public as $$
declare token text; normalized text := lower(trim(invited_email_input));
begin
 perform public.require_active_household(target_household);
 if not public.is_household_owner(target_household) then raise exception 'owner permission required'; end if;
 if (select count(*) from public.household_members where household_id=target_household and active) >= 2 then raise exception 'household already has two active members'; end if;
 if normalized !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid email'; end if;
 token := encode(extensions.gen_random_bytes(32),'hex');
 insert into public.invitations(household_id,email,token_hash,expires_at,invited_by) values(target_household,normalized,encode(extensions.digest(token,'sha256'),'hex'),now()+interval '7 days',auth.uid());
 return token;
end; $$;
create or replace function public.accept_invitation(raw_token text) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare inv public.invitations; user_email text;
begin
 select lower(email) into user_email from auth.users where id=auth.uid();
 select * into inv from public.invitations where token_hash=encode(extensions.digest(raw_token,'sha256'),'hex') for update;
 if inv.id is null or inv.status <> 'pending' or inv.expires_at <= now() then raise exception 'invitation is invalid or expired'; end if;
 if lower(inv.email) <> user_email then raise exception 'invitation email does not match signed-in account'; end if;
 if not exists(select 1 from public.households where id=inv.household_id and status='active') then raise exception 'household is archived'; end if;
 if (select count(*) from public.household_members where household_id=inv.household_id and active) >= 2 then raise exception 'household already has two active members'; end if;
 insert into public.household_members(household_id,user_id,role) values(inv.household_id,auth.uid(),'member');
 update public.invitations set status='accepted',accepted_at=now(),accepted_by=auth.uid() where id=inv.id;
 return inv.household_id;
end; $$;
create or replace function public.create_investment_direct(target_household uuid, investment_name text, ticker_input text, asset_type_input text, investment_currency text) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$ declare id uuid; begin perform public.require_active_household(target_household); if investment_currency not in ('USD','CNY','HKD') then raise exception 'invalid currency'; end if; insert into public.investments(household_id,name,ticker,asset_type,currency,opening_quantity_milli,opening_cost_minor,created_by) values(target_household,investment_name,nullif(ticker_input,''),asset_type_input,investment_currency,0,0,auth.uid()) returning id into id; insert into public.audit_logs(household_id,actor_id,action,entity_type,entity_id) values(target_household,auth.uid(),'create','investment',id); return id; end; $$;
create or replace function public.set_investment_price(target_investment uuid, value_date_input date, price_minor bigint, note_input text default null) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$ declare inv public.investments; valuation_id uuid; begin select * into inv from public.investments where id=target_investment for update; if inv.id is null then raise exception 'investment not found'; end if; perform public.require_active_household(inv.household_id); if inv.archived_at is not null or price_minor<=0 then raise exception 'invalid price update'; end if; insert into public.investment_valuations(household_id,investment_id,value_date,unit_value_minor,currency,note,created_by,source) values(inv.household_id,inv.id,value_date_input,price_minor,inv.currency,note_input,auth.uid(),'manual_direct') returning id into valuation_id; update public.investments set latest_price_minor=price_minor,latest_price_updated_at=now(),latest_price_updated_by=auth.uid() where id=inv.id; insert into public.audit_logs(household_id,actor_id,action,entity_type,entity_id) values(inv.household_id,auth.uid(),'set_price','investment',inv.id); return valuation_id; end; $$;
create or replace function public.archive_household(target_household uuid, reason text) returns void language plpgsql security definer set search_path=pg_catalog,public as $$ begin if not public.is_household_owner(target_household) then raise exception 'owner permission required'; end if; if exists(select 1 from public.proposals where household_id=target_household and status in ('pending_approval','overdue_pending')) then raise exception 'resolve pending proposals before archiving'; end if; update public.households set status='archived',archived_at=now(),archived_by=auth.uid(),archive_reason=reason where id=target_household and status='active'; update public.invitations set status='revoked',revoked_at=now() where household_id=target_household and status='pending'; end; $$;
grant execute on function public.create_invitation(uuid,text),public.accept_invitation(text),public.create_investment_direct(uuid,text,text,text,text),public.set_investment_price(uuid,date,bigint,text),public.archive_household(uuid,text) to authenticated;
