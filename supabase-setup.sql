-- Desk Cube: database setup for Supabase.
-- Paste all of this into Supabase → SQL Editor → New query, then press Run. Safe to run more than once.

-- One row per signed-in person: display name and page settings.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 40),
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- One row per finished timed solve.
create table if not exists public.solves (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  time_ms integer not null check (time_ms > 0 and time_ms < 86400000),
  moves integer check (moves >= 0),
  scramble text check (char_length(scramble) <= 300),
  solved_at timestamptz not null default now()
);
create index if not exists solves_user_time on public.solves (user_id, solved_at desc);

-- Let signed-in people reach these tables through the Data API (the page only uses these actions).
-- Signed-out visitors (anon) get nothing.
grant usage on schema public to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, delete on public.solves to authenticated;
grant usage on sequence public.solves_id_seq to authenticated;
revoke all on public.profiles, public.solves from anon;

-- Row Level Security: everyone can only see and change their own rows.
alter table public.profiles enable row level security;
alter table public.solves enable row level security;

drop policy if exists "own profile: read" on public.profiles;
drop policy if exists "own profile: insert" on public.profiles;
drop policy if exists "own profile: update" on public.profiles;
create policy "own profile: read" on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy "own profile: insert" on public.profiles for insert to authenticated with check (id = (select auth.uid()));
create policy "own profile: update" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy if exists "own solves: read" on public.solves;
drop policy if exists "own solves: insert" on public.solves;
drop policy if exists "own solves: delete" on public.solves;
create policy "own solves: read" on public.solves for select to authenticated using (user_id = (select auth.uid()));
create policy "own solves: insert" on public.solves for insert to authenticated with check (user_id = (select auth.uid()));
create policy "own solves: delete" on public.solves for delete to authenticated using (user_id = (select auth.uid()));

-- "Delete my account": removes the signed-in person and, through the cascades above, all their data.
create or replace function public.delete_my_account()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from auth.users where id = auth.uid();
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
