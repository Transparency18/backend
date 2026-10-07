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
