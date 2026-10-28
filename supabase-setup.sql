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

-- ===== Update 2: replays, Official competition rounds and the leaderboard =====
-- Each solve can carry its replay (every turn with its time), whether it was a competition solve,
-- which round of 5 it belongs to, and whether it was a DNF (gave up).
alter table public.solves add column if not exists replay text check (char_length(replay) <= 40000);
alter table public.solves add column if not exists competition boolean not null default false;
alter table public.solves add column if not exists round_id uuid;
alter table public.solves add column if not exists dnf boolean not null default false;
create index if not exists solves_competition on public.solves (competition, user_id) where competition;
-- People choose whether their competition results appear on the public leaderboard.
alter table public.profiles add column if not exists on_leaderboard boolean not null default true;

-- Public leaderboard: everyone's best competition single, with the replay so it can be watched.
-- Runs with the owner's rights but returns only display names and results, never emails or ids.
create or replace function public.leaderboard_singles(lim int default 50)
returns table (name text, time_ms int, moves int, solved_at timestamptz, scramble text, replay text)
language sql stable security definer set search_path = ''
as $$
  select coalesce(nullif(p.display_name, ''), 'Anonymous cuber'), b.time_ms, b.moves, b.solved_at, b.scramble, b.replay
  from (
    select distinct on (s.user_id) s.user_id, s.time_ms, s.moves, s.solved_at, s.scramble, s.replay
    from public.solves s
    where s.competition and not s.dnf and s.replay is not null
    order by s.user_id, s.time_ms, s.solved_at
  ) b
  join public.profiles p on p.id = b.user_id and p.on_leaderboard
  order by b.time_ms, b.solved_at
  limit least(greatest(lim, 1), 100);
$$;

-- Everyone's best average of 5 from a complete competition round: drop the fastest and slowest,
-- average the middle three. One DNF counts as the slowest; rounds with two or more DNFs don't count.
create or replace function public.leaderboard_averages(lim int default 50)
returns table (name text, average_ms int, times int[], dnfs boolean[], finished_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  with rounds as (
    select s.user_id, s.round_id, count(*) as n, count(*) filter (where s.dnf) as d,
      array_agg(s.time_ms order by s.solved_at) as times, array_agg(s.dnf order by s.solved_at) as dnfs,
      max(s.solved_at) as finished_at,
      sum(s.time_ms) filter (where not s.dnf) as total,
      min(s.time_ms) filter (where not s.dnf) as fastest,
      max(s.time_ms) filter (where not s.dnf) as slowest
    from public.solves s
    where s.competition and s.round_id is not null
    group by s.user_id, s.round_id
  ), averages as (
    select user_id, times, dnfs, finished_at,
      case when d = 0 then (total - fastest - slowest) / 3 else (total - fastest) / 3 end as average_ms
    from rounds
    where n = 5 and d <= 1
  ), best as (
    select distinct on (user_id) * from averages order by user_id, average_ms, finished_at
  )
  select coalesce(nullif(p.display_name, ''), 'Anonymous cuber'), b.average_ms::int, b.times, b.dnfs, b.finished_at
  from best b
  join public.profiles p on p.id = b.user_id and p.on_leaderboard
  order by b.average_ms, b.finished_at
  limit least(greatest(lim, 1), 100);
$$;
revoke all on function public.leaderboard_singles(int) from public;
revoke all on function public.leaderboard_averages(int) from public;
grant execute on function public.leaderboard_singles(int) to anon, authenticated;
grant execute on function public.leaderboard_averages(int) to anon, authenticated;

-- ===== Update 3: the daily challenge =====
-- Everyone gets the same scramble each day (UTC). A daily solve stores that day; one try per person per day.
alter table public.solves add column if not exists daily date;
create unique index if not exists solves_one_daily on public.solves (user_id, daily) where daily is not null;
-- Daily results can only be saved for today (or yesterday, for a try that ran over midnight),
-- and can't be deleted until two days later, so nobody can delete a bad try and go again.
drop policy if exists "own solves: insert" on public.solves;
drop policy if exists "own solves: delete" on public.solves;
create policy "own solves: insert" on public.solves for insert to authenticated with check (
  user_id = (select auth.uid())
  and (daily is null or daily >= (now() at time zone 'utc')::date - 1 and daily <= (now() at time zone 'utc')::date)
);
create policy "own solves: delete" on public.solves for delete to authenticated using (
  user_id = (select auth.uid())
  and (daily is null or daily < (now() at time zone 'utc')::date - 1)
);

-- Public results for one day's challenge: finished times first, then DNFs.
create or replace function public.leaderboard_daily(day date, lim int default 50)
returns table (name text, time_ms int, moves int, dnf boolean, solved_at timestamptz, scramble text, replay text)
language sql stable security definer set search_path = ''
as $$
  select coalesce(nullif(p.display_name, ''), 'Anonymous cuber'), s.time_ms, s.moves, s.dnf, s.solved_at, s.scramble, s.replay
  from public.solves s
  join public.profiles p on p.id = s.user_id and p.on_leaderboard
  where s.daily = day
  order by s.dnf, s.time_ms, s.solved_at
  limit least(greatest(lim, 1), 200);
$$;
revoke all on function public.leaderboard_daily(date, int) from public;
grant execute on function public.leaderboard_daily(date, int) to anon, authenticated;

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
