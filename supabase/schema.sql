-- Demo 1 (Bright Smile Dental): member list + booking list.
-- Run once in Supabase > SQL Editor > New query > paste > Run. Safe to re-run.
--
-- The Worker talks to these tables with the service-role (secret) key, which bypasses RLS.
-- RLS is enabled with no policies, so the public anon key can't read patient data.

-- ---------- members: one row per patient, 1 member_id = 1 phone ----------
create table if not exists public.members (
  member_id   text primary key check (member_id ~ '^[0-9]{6}$'),   -- 6 digits, easy to say on a call
  phone       text not null unique check (phone ~ '^[0-9]{7,10}$'), -- last 10 digits of the number
  name        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------- bookings: mirror of Cal.com, one row per appointment ----------
create table if not exists public.bookings (
  id                bigint generated always as identity primary key,
  cal_uid           text not null unique,            -- current Cal.com booking uid
  previous_cal_uid  text,                            -- uid before the last reschedule
  member_id         text references public.members(member_id) on delete set null,
  phone             text,
  patient_name      text,
  reason            text,
  start_at          timestamptz not null,
  end_at            timestamptz,
  status            text not null default 'booked' check (status in ('booked', 'cancelled')),
  source            text not null default 'voice-agent',  -- voice-agent | calcom (made in Cal.com directly)
  call_id           text,                                  -- Vapi call that created or last changed it
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists bookings_member_start_idx on public.bookings (member_id, start_at);
create index if not exists bookings_phone_start_idx  on public.bookings (phone, start_at);
create index if not exists bookings_upcoming_idx     on public.bookings (start_at) where status = 'booked';

-- ---------- updated_at ----------
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------- phone normalisation: any format in -> last 10 digits (same key the Worker uses) ----------
-- So "+1 (512) 555-0142", "512.555.0142" and caller ID all become "5125550142", even for manual edits.
create or replace function public.normalize_phone() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.phone is not null then
    new.phone := nullif(right(regexp_replace(new.phone, '[^0-9]', '', 'g'), 10), '');
  end if;
  return new;
end $$;

drop trigger if exists members_phone on public.members;
create trigger members_phone before insert or update of phone on public.members
  for each row execute function public.normalize_phone();

drop trigger if exists bookings_phone on public.bookings;
create trigger bookings_phone before insert or update of phone on public.bookings
  for each row execute function public.normalize_phone();

-- fix rows saved before this trigger existed
update public.bookings set phone = phone where phone is not null and phone !~ '^[0-9]{7,10}$';

drop trigger if exists members_touch on public.members;
create trigger members_touch before update on public.members
  for each row execute function public.touch_updated_at();

drop trigger if exists bookings_touch on public.bookings;
create trigger bookings_touch before update on public.bookings
  for each row execute function public.touch_updated_at();

-- ---------- get_or_create_member: returns the member for a phone, creating one if new ----------
-- Atomic, so two calls at once from the same number can't create two members.
create or replace function public.get_or_create_member(p_phone text, p_name text default null)
returns table (member_id text, is_new boolean)
language plpgsql set search_path = public as $$
#variable_conflict use_column
declare
  v_id text;
begin
  select m.member_id into v_id from public.members m where m.phone = p_phone;
  if found then
    return query select v_id, false;
    return;
  end if;

  loop
    v_id := (100000 + floor(random() * 900000))::int::text;  -- 100000..999999, never a leading zero
    begin
      insert into public.members (member_id, phone, name) values (v_id, p_phone, nullif(p_name, ''));
      return query select v_id, true;
      return;
    exception when unique_violation then
      -- Either this phone was just inserted by another call, or the random id is taken.
      select m.member_id into v_id from public.members m where m.phone = p_phone;
      if found then
        return query select v_id, false;
        return;
      end if;
      -- id collision: loop and try another id
    end;
  end loop;
end $$;

-- ---------- schedule: what the owner opens in the Supabase table editor ----------
create or replace view public.schedule with (security_invoker = true) as
select
  to_char(b.start_at at time zone 'America/New_York', 'Dy Mon DD, HH12:MI AM') as appointment,
  b.patient_name,
  b.member_id,
  b.phone,
  b.reason,
  b.source,
  b.start_at
from public.bookings b
where b.status = 'booked' and b.start_at >= now() - interval '1 hour'
order by b.start_at;

-- ---------- lock down ----------
alter table public.members  enable row level security;
alter table public.bookings enable row level security;

revoke all on public.members, public.bookings, public.schedule from anon, authenticated;
revoke execute on function public.get_or_create_member(text, text) from public, anon, authenticated;
grant  execute on function public.get_or_create_member(text, text) to service_role;
