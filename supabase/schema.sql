-- Run this once in the Supabase dashboard: SQL Editor -> New query -> Run.

-- Resident profile data. Login credentials live in Supabase Auth (auth.users);
-- each profile row shares its id with the matching auth user.
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  name        text not null,
  email       text unique,  -- optional; login is by mobile number
  phone       text,  -- phone, phase and villa_no are required on the register form;
  phase       text,  -- they stay empty only for volunteer accounts created with
  villa_no    text,  -- "npm run db:seed-volunteer"
  photo_url   text,  -- optional
  role        text not null default 'member' check (role in ('member', 'volunteer', 'guard')),
  created_at  timestamptz not null default now()
);

-- Adds the role column to tables created before it existed. New sign-ups are
-- always 'member'; promote someone by editing their row in the Supabase table editor.
alter table public.profiles
  add column if not exists role text not null default 'member'
  check (role in ('member', 'volunteer', 'guard'));

-- Loosen older tables that were created with these as NOT NULL.
alter table public.profiles
  alter column phone drop not null,
  alter column phase drop not null,
  alter column villa_no drop not null,
  alter column photo_url drop not null;

-- Login by mobile number: email optional, one account per number.
alter table public.profiles alter column email drop not null;
update public.profiles set email = null where email = '';
-- Store numbers in one format ("+91 98765 43210" -> "9876543210"), matching lib/phone.js.
update public.profiles
  set phone = regexp_replace(regexp_replace(phone, '[\s()-]', '', 'g'), '^\+?91(\d{10})$', '\1')
  where phone is not null;
create unique index if not exists profiles_phone_key on public.profiles (phone);

-- RLS on with no policies: only the backend (secret key) can read/write.
alter table public.profiles enable row level security;

-- Public bucket for profile photos (backend compresses each to under 1 MB).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Complaints reported by members, guards and volunteers (Complains page).
-- Who can do what is enforced in routes/complaints.js.
create table if not exists public.complaints (
  id               uuid primary key default gen_random_uuid(),
  ticket_no        bigint generated always as identity,
  category         text not null,
  description      text not null,
  location         text,
  phase            text not null,
  priority         text not null default 'Medium' check (priority in ('Low', 'Medium', 'High')),
  status           text not null default 'Open' check (status in ('Open', 'In Progress', 'Resolved', 'Closed')),
  reported_by      uuid references public.profiles (id) on delete set null,
  reporter_name    text not null,
  reporter_role    text not null,
  reporter_villa   text,
  reply            text,
  replied_by_name  text,
  replied_at       timestamptz,
  resolved_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists complaints_reported_by_idx on public.complaints (reported_by);
create index if not exists complaints_created_at_idx on public.complaints (created_at desc);
alter table public.complaints enable row level security;

-- CCTV cameras (CCTV Cameras page). Who can do what is enforced in routes/cameras.js.
create table if not exists public.cameras (
  id                      uuid primary key default gen_random_uuid(),
  camera_no               bigint generated always as identity,  -- shown as CAM-001
  name                    text not null,
  phase                   text not null,
  location                text not null,
  type                    text not null default 'Bullet' check (type in ('Bullet', 'Dome', 'PTZ', 'Other')),
  status                  text not null default 'Working' check (status in ('Working', 'Not Working', 'Under Maintenance')),
  status_note             text,
  status_updated_by_name  text,
  status_updated_at       timestamptz,
  last_maintenance        date,
  notes                   text,
  created_by              uuid references public.profiles (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index if not exists cameras_phase_idx on public.cameras (phase);
alter table public.cameras enable row level security;

-- Every status change, so residents can see when a camera went down and who fixed it.
create table if not exists public.camera_status_log (
  id               uuid primary key default gen_random_uuid(),
  camera_id        uuid not null references public.cameras (id) on delete cascade,
  status           text not null,
  note             text,
  changed_by       uuid references public.profiles (id) on delete set null,
  changed_by_name  text not null,
  changed_by_role  text not null,
  created_at       timestamptz not null default now()
);
create index if not exists camera_status_log_camera_idx on public.camera_status_log (camera_id, created_at desc);
alter table public.camera_status_log enable row level security;
