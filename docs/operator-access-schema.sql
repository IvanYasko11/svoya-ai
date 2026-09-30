-- Server-managed admission and job ownership. Existing records are preserved.
create table public.operator_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.operator_access enable row level security;
revoke all on public.operator_access from public,anon,authenticated;
grant select on public.operator_access to authenticated;
grant all on public.operator_access to service_role;
create policy operator_access_self_read on public.operator_access for select to authenticated
using ((select auth.uid())=user_id);

create table public.operator_jobs (
  task_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  apply_changes boolean not null,
  created_at timestamptz not null default now()
);
create index operator_jobs_user_id_idx on public.operator_jobs(user_id);
alter table public.operator_jobs enable row level security;
revoke all on public.operator_jobs from public,anon,authenticated;
grant select on public.operator_jobs to authenticated;
grant all on public.operator_jobs to service_role;
create policy operator_jobs_owner_read on public.operator_jobs for select to authenticated
using ((select auth.uid())=user_id and exists (
  select 1 from public.operator_access a where a.user_id=(select auth.uid()) and a.enabled
));

alter table public.coding_approvals add column user_id uuid references auth.users(id) on delete cascade;
create index coding_approvals_user_id_idx on public.coding_approvals(user_id);
alter table public.tasks add column user_id uuid references auth.users(id) on delete cascade;
create index tasks_user_id_idx on public.tasks(user_id);
-- These two tables are server-only, including legacy rows without an owner.
alter table public.coding_approvals enable row level security;
alter table public.tasks enable row level security;
revoke all on public.coding_approvals,public.tasks from public,anon,authenticated;
grant all on public.coding_approvals,public.tasks to service_role;

-- SECURITY DEFINER is needed only to check the caller's private auth session.
-- No arguments or user metadata influence identity. Only the caller's identity and admission are exposed.
create schema svoya_private;
revoke all on schema svoya_private from public,anon,authenticated;
grant usage on schema svoya_private to authenticated;
create function svoya_private.operator_access_check() returns jsonb
language sql stable security definer set search_path=''
as $$
  select pg_catalog.jsonb_build_object(
    'user_id', (select auth.uid()),
    'session_id', (select auth.jwt())->>'session_id',
    'active_session', exists (
      select 1 from auth.sessions s
      where s.user_id=(select auth.uid())
        and s.id=nullif((select auth.jwt())->>'session_id','')::uuid
        and (s.not_after is null or s.not_after>now())
    ),
    'allowed', exists (
      select 1 from public.operator_access a
      where a.user_id=(select auth.uid()) and a.enabled
    )
  );
$$;
revoke all on function svoya_private.operator_access_check() from public,anon;
grant execute on function svoya_private.operator_access_check() to authenticated;
create function public.operator_access_check() returns jsonb
language sql stable security invoker set search_path=''
as $$ select svoya_private.operator_access_check(); $$;
revoke all on function public.operator_access_check() from public,anon;
grant execute on function public.operator_access_check() to authenticated;
