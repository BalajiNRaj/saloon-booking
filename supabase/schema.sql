-- Salon Booking Bot – database schema (run once in Supabase → SQL Editor)
-- All times are stored in UTC (timestamptz). The bot shows them in India time (IST).

create extension if not exists btree_gist;   -- needed for the "no double booking" rule

-- One row per salon you sign up. wa_phone_number_id comes from Meta (WhatsApp → API Setup).
create table if not exists salons (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  wa_phone_number_id text not null unique,
  open_time          time not null default '10:00',
  close_time         time not null default '20:00',
  closed_days        int[] not null default '{}',   -- 0 = Sunday … 6 = Saturday
  slot_step_min      int  not null default 30,
  min_lead_min       int  not null default 30,      -- earliest booking = now + this many minutes
  created_at         timestamptz not null default now()
);

create table if not exists staff (
  id         uuid primary key default gen_random_uuid(),
  salon_id   uuid not null references salons(id) on delete cascade,
  name       text not null,
  off_days   int[] not null default '{}',            -- weekly days off, 0 = Sunday
  active     boolean not null default true,
  sort       int not null default 0
);

create table if not exists services (
  id           uuid primary key default gen_random_uuid(),
  salon_id     uuid not null references salons(id) on delete cascade,
  name         text not null,
  duration_min int  not null check (duration_min > 0),
  price        int  not null default 0,               -- rupees
  active       boolean not null default true,
  sort         int not null default 0
);

create table if not exists bookings (
  id                   uuid primary key default gen_random_uuid(),
  ref_no               bigint generated always as identity (start with 1001),  -- shown as B1001 etc.
  salon_id             uuid not null references salons(id) on delete cascade,
  staff_id             uuid not null references staff(id),
  service_id           uuid not null references services(id),
  customer_phone       text not null,
  customer_name        text,
  start_at             timestamptz not null,
  end_at               timestamptz not null,
  price                int not null default 0,
  status               text not null default 'confirmed'
                       check (status in ('confirmed','pending','cancelled','noshow','completed')),
  source               text not null default 'whatsapp',      -- whatsapp | walkin | phone
  reminder_24h_sent_at timestamptz,
  reminder_2h_sent_at  timestamptz,
  created_at           timestamptz not null default now(),
  check (end_at > start_at),
  -- The database itself refuses two active bookings for the same stylist at overlapping times.
  constraint no_double_booking exclude using gist (
    staff_id with =,
    tstzrange(start_at, end_at, '[)') with &&
  ) where (status in ('confirmed','pending'))
);
create index if not exists bookings_salon_start on bookings (salon_id, start_at);
create index if not exists bookings_customer on bookings (salon_id, customer_phone);

-- Where each customer is in the menu (chosen service, stylist, date…).
create table if not exists sessions (
  salon_id       uuid not null references salons(id) on delete cascade,
  customer_phone text not null,
  data           jsonb not null default '{}',
  updated_at     timestamptz not null default now(),
  primary key (salon_id, customer_phone)
);

-- Full chat history, in and out (for the admin page).
create table if not exists messages (
  id             bigint generated always as identity primary key,
  salon_id       uuid not null references salons(id) on delete cascade,
  customer_phone text not null,
  direction      text not null check (direction in ('in','out')),
  wa_message_id  text unique,          -- stops WhatsApp retries being handled twice
  body           text,
  created_at     timestamptz not null default now()
);
create index if not exists messages_chat on messages (salon_id, customer_phone, created_at);

-- "Talk to salon" requests, for staff to call back.
create table if not exists handoff_requests (
  id             bigint generated always as identity primary key,
  salon_id       uuid not null references salons(id) on delete cascade,
  customer_phone text not null,
  customer_name  text,
  resolved       boolean not null default false,
  created_at     timestamptz not null default now()
);

-- Lock everything down: only the server (service role key) can read/write.
alter table salons           enable row level security;
alter table staff            enable row level security;
alter table services         enable row level security;
alter table bookings         enable row level security;
alter table sessions         enable row level security;
alter table messages         enable row level security;
alter table handoff_requests enable row level security;
