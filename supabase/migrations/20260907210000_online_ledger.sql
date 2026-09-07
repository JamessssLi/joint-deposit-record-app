-- Online shared-ledger schema. Apply only to a new Supabase project.
create extension if not exists pgcrypto;

create type public.member_role as enum ('owner', 'member');
create type public.proposal_status as enum ('pending_approval', 'approved', 'rejected', 'withdrawn', 'overdue_pending');
create type public.entry_status as enum ('posted', 'voided');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 60),
  created_at timestamptz not null default now()
);
create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  reporting_currency text not null default 'USD' check (reporting_currency in ('USD','CNY','HKD')),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.member_role not null default 'member',
  active boolean not null default true,
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  email text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  invited_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create table public.fx_rates (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  base_currency text not null check (base_currency in ('USD','CNY','HKD')),
  quote_currency text not null check (quote_currency in ('USD','CNY','HKD')),
  rate numeric(20,10) not null check (rate > 0),
  effective_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id)
);
create table public.investments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  ticker text,
  asset_type text not null default 'other',
  currency text not null check (currency in ('USD','CNY','HKD')),
  opening_quantity_milli bigint not null default 0 check (opening_quantity_milli >= 0),
  opening_cost_minor bigint not null default 0 check (opening_cost_minor >= 0),
  created_at timestamptz not null default now()
);
create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  submitter_id uuid not null references public.profiles(id),
  status public.proposal_status not null default 'pending_approval',
  payload jsonb not null,
  idempotency_key uuid not null,
  submitted_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles(id),
  decision_note text,
  unique (household_id, submitter_id, idempotency_key)
);
create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  proposal_id uuid unique not null references public.proposals(id),
  entry_type text not null check (entry_type in ('opening_balance','deposit','expense','expense_refund','reimbursement','settlement','investment_buy','investment_sell','dividend')),
  status public.entry_status not null default 'posted',
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency in ('USD','CNY','HKD')),
  occurred_at date not null,
  title text not null,
  category text,
  member_id uuid references public.profiles(id),
  investment_id uuid references public.investments(id),
  quantity_milli bigint,
  unit_price_minor bigint,
  created_at timestamptz not null default now()
);
create table public.investment_valuations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  investment_id uuid not null references public.investments(id) on delete cascade,
  proposal_id uuid unique not null references public.proposals(id),
  value_date date not null,
  unit_value_minor bigint not null check (unit_value_minor > 0),
  currency text not null check (currency in ('USD','CNY','HKD')),
  note text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create table public.audit_logs (
  id bigint generated always as identity primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, display_name)
  values (new.id, coalesce(nullif(new.raw_user_meta_data->>'display_name',''), split_part(new.email, '@', 1)));
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

create or replace function public.is_household_member(target_household uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.household_members where household_id = target_household and user_id = auth.uid() and active);
$$;
