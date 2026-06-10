create extension if not exists pgcrypto;

create or replace function public.set_current_timestamp_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.phone_calls (
  local_call_id text primary key default gen_random_uuid()::text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  state text not null,

  twilio_call_sid text unique,
  twilio_account_sid text,
  twilio_from text,
  twilio_to text,
  twilio_direction text,
  twilio_status text,
  twilio_initial_payload jsonb not null default '{}'::jsonb,
  twilio_status_events jsonb not null default '[]'::jsonb,

  ultravox_call_id text unique,
  ultravox_join_url text,
  ultravox_status text,
  ultravox_events jsonb not null default '[]'::jsonb,

  last_error jsonb,

  constraint phone_calls_twilio_status_events_is_array
    check (jsonb_typeof(twilio_status_events) = 'array'),
  constraint phone_calls_ultravox_events_is_array
    check (jsonb_typeof(ultravox_events) = 'array')
);

create index if not exists phone_calls_created_at_idx
  on public.phone_calls (created_at desc);

create index if not exists phone_calls_state_idx
  on public.phone_calls (state);

create index if not exists phone_calls_twilio_from_idx
  on public.phone_calls (twilio_from);

create index if not exists phone_calls_twilio_to_idx
  on public.phone_calls (twilio_to);

drop trigger if exists set_phone_calls_updated_at on public.phone_calls;

create trigger set_phone_calls_updated_at
before update on public.phone_calls
for each row
execute function public.set_current_timestamp_updated_at();

alter table public.phone_calls enable row level security;

comment on table public.phone_calls is
  'Inbound phone call log for the Twilio to Ultravox bridge.';
