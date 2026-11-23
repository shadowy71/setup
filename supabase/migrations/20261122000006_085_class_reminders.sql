-- Campus+ migration 085 — personalized class reminders
-- Supabase CLI filename: 20261122000006_085_class_reminders.sql
-- This file is part of the single authoritative migration history in supabase/migrations/.
-- =============================================================================
-- Campus+ 085 — personalized class reminders (no broadcasts, no anonymous subs)
-- =============================================================================
-- A student who signs in, has a division in their profile, and explicitly
-- enables "Class reminder popups" receives a subtle reminder 10 minutes
-- before each of their own classes. The division is always read from
-- `profiles.division` for the authenticated profile — never from a URL,
-- browser storage, or client-supplied value — and every reminder is
-- addressed to one profile and delivered only to that profile's own
-- registered devices.
--
-- What this migration adds:
--   * `profile_private.class_reminder_popups` — the per-account opt-in,
--     disabled by default, never client-writable directly (column
--     privileges from migration 015 already revoke UPDATE on the table).
--   * `push_subscriptions` — one row per browser push endpoint, owned by
--     exactly one profile. Endpoints are unique, so signing in again (or
--     switching accounts on the same browser) transfers the endpoint to the
--     new owner instead of duplicating it. RLS restricts reads
--     to the owner's own rows; writes use audited RPCs; endpoints and keys are never publicly
--     readable.
--   * `class_reminder_queue` — server-side materialisation of upcoming
--     reminders, one row per (profile, class). The unique constraint makes
--     duplicate scheduler executions harmless. No client access at all:
--     only the service role (scheduler/dispatcher) and definer functions
--     may read or write it.
--   * Definer functions for the preference toggle, subscription upsert and
--     deactivation, plus triggers that cancel future reminders the moment
--     the profile (division, status, preference) changes. Delivery always
--     re-checks the current profile before sending — a queued row is never
--     trusted on its own.
--
-- Forward-only: no earlier migration is edited.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Per-account preference
-- ----------------------------------------------------------------------------

alter table public.profile_private
  add column if not exists class_reminder_popups boolean not null default false;

comment on column public.profile_private.class_reminder_popups is
  'Per-account opt-in for personalized class reminders (10 minutes before each class). Disabled by default; changed only through set_class_reminder_preference() so the change is audited and queued reminders are cancelled.';

create index if not exists profile_private_class_reminder_idx
  on public.profile_private (class_reminder_popups, account_type, account_status)
  where class_reminder_popups = true;

-- ----------------------------------------------------------------------------
-- 2. Push subscriptions (one endpoint, one owner)
-- ----------------------------------------------------------------------------

create table public.push_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null references public.profiles (id) on delete cascade,
  endpoint        text not null unique
                  check (length(endpoint) between 1 and 2000 and endpoint like 'https://%'),
  p256dh          text not null check (length(p256dh) between 1 and 500),
  auth            text not null check (length(auth) between 1 and 500),
  user_agent      text check (user_agent is null or length(user_agent) <= 500),
  is_active       boolean not null default true,
  failure_count   integer not null default 0 check (failure_count >= 0),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error      text check (last_error is null or length(last_error) <= 500),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index push_subscriptions_profile_active_idx
  on public.push_subscriptions (profile_id) where is_active = true;

create trigger push_subscriptions_touch before update on public.push_subscriptions
  for each row execute function public.touch_updated_at();

comment on table public.push_subscriptions is
  'Web Push endpoints owned by exactly one profile. One user may have many devices; one endpoint belongs to one profile at a time (unique endpoint, upsert transfers ownership on account switch). RLS restricts reads to the owner; mutations use RPCs or the service role.';

alter table public.push_subscriptions enable row level security;

create policy push_subscriptions_select_own on public.push_subscriptions
  for select to authenticated using (profile_id = public.current_profile_id());
create policy push_subscriptions_insert_own on public.push_subscriptions
  for insert to authenticated with check (profile_id = public.current_profile_id());
create policy push_subscriptions_update_own on public.push_subscriptions
  for update to authenticated
  using (profile_id = public.current_profile_id())
  with check (profile_id = public.current_profile_id());
create policy push_subscriptions_delete_own on public.push_subscriptions
  for delete to authenticated using (profile_id = public.current_profile_id());

-- Explicit grants (RLS still restricts rows). The endpoint and keys are
-- readable only by the owner through these policies — never by anon.
revoke all on public.push_subscriptions from anon, public;
grant select on public.push_subscriptions to authenticated;
revoke insert, update, delete on public.push_subscriptions from authenticated;
grant all on public.push_subscriptions to service_role;

-- ----------------------------------------------------------------------------
-- 3. Reminder queue (server-only)
-- ----------------------------------------------------------------------------

create table public.class_reminder_queue (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references public.profiles (id) on delete cascade,
  division      text not null check (division ~ '^[A-R]$'),
  event_key     text not null check (length(event_key) between 1 and 200),
  event_day     text not null check (event_day in ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday')),
  event_date    date not null,
  class_start_at timestamptz not null,
  reminder_at   timestamptz not null,
  subject       text check (subject is null or length(subject) <= 80),
  time_label    text check (time_label is null or length(time_label) <= 40),
  kind          text not null default 'standard' check (kind in ('standard', 'batch')),
  status        text not null default 'pending'
                check (status in ('pending', 'delivered', 'skipped', 'cancelled', 'failed')),
  skipped_reason text check (skipped_reason is null or length(skipped_reason) <= 80),
  delivered_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint class_reminder_queue_times_valid check (reminder_at < class_start_at),
  constraint class_reminder_queue_unique unique (profile_id, event_key)
);

create index class_reminder_queue_due_idx
  on public.class_reminder_queue (reminder_at) where status = 'pending';
create index class_reminder_queue_profile_idx
  on public.class_reminder_queue (profile_id, reminder_at) where status = 'pending';

create trigger class_reminder_queue_touch before update on public.class_reminder_queue
  for each row execute function public.touch_updated_at();

comment on table public.class_reminder_queue is
  'Server-materialised class reminders, one per (profile, class). Written only by the scheduler (service role); read only by the dispatcher, which re-checks the current profile before delivery. No client access.';

alter table public.class_reminder_queue enable row level security;

-- No policies for authenticated: the queue is never client-readable. The
-- service role bypasses RLS for scheduling/delivery; definer functions run
-- as the owner and can maintain it.
revoke all on public.class_reminder_queue from anon, public, authenticated;
grant all on public.class_reminder_queue to service_role;

-- ----------------------------------------------------------------------------
-- 4. Cancellation helper
-- ----------------------------------------------------------------------------

create or replace function public.cancel_future_class_reminders(p_profile uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if p_profile is null then
    return 0;
  end if;
  update public.class_reminder_queue
     set status = 'cancelled',
         skipped_reason = 'profile-changed',
         updated_at = now()
   where profile_id = p_profile
     and status = 'pending'
     and reminder_at > now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.cancel_future_class_reminders(uuid) is
  'Cancels every future pending reminder for one profile. Called by the preference toggle and by the profile-change triggers; the scheduler reconciles the new set afterwards.';

revoke all on function public.cancel_future_class_reminders(uuid) from public, anon, authenticated;
grant execute on function public.cancel_future_class_reminders(uuid) to service_role;

-- ----------------------------------------------------------------------------
-- 5. Preference toggle (the only way to change the opt-in)
-- ----------------------------------------------------------------------------

create or replace function public.set_class_reminder_preference(p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := public.current_profile_id();
  v_type public.account_type;
begin
  if v_me is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not public.is_active_profile(v_me) then
    raise exception 'Account is not active' using errcode = '42501';
  end if;
  select pp.account_type into v_type
    from public.profile_private pp where pp.profile_id = v_me;
  if v_type is distinct from 'student' then
    raise exception 'Class reminders are available to institutional students only.' using errcode = '42501';
  end if;

  update public.profile_private
     set class_reminder_popups = coalesce(p_enabled, false),
         updated_at = now()
   where profile_id = v_me;

  if coalesce(p_enabled, false) = false then
    -- Disabling cancels future reminders and deactivates push delivery.
    perform public.cancel_future_class_reminders(v_me);
    update public.push_subscriptions
       set is_active = false, updated_at = now()
     where profile_id = v_me and is_active = true;

  end if;

  perform public.log_audit(
    'account.class_reminder_preference_changed', 'user', v_me::text,
    jsonb_build_object('enabled', coalesce(p_enabled, false)),
    false, null, 'private'
  );
  return coalesce(p_enabled, false);
end;
$$;

comment on function public.set_class_reminder_preference(boolean) is
  'The only way to change the class-reminder opt-in. Derives the profile from the session, refuses non-students, cancels future reminders and deactivates push on disable, and audits the change.';

revoke all on function public.set_class_reminder_preference(boolean) from public, anon;
grant execute on function public.set_class_reminder_preference(boolean) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6. Subscription upsert / deactivation (session-derived ownership)
-- ----------------------------------------------------------------------------

create or replace function public.upsert_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := public.current_profile_id();
  v_type public.account_type;
  v_enabled boolean;
  v_division text;
  v_id uuid;
begin
  if v_me is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not public.is_active_profile(v_me) then
    raise exception 'Account is not active' using errcode = '42501';
  end if;
  select pp.account_type, pp.class_reminder_popups into v_type, v_enabled
    from public.profile_private pp where pp.profile_id = v_me;
  if v_type is distinct from 'student' then
    raise exception 'Class reminders are available to institutional students only.' using errcode = '42501';
  end if;
  if coalesce(v_enabled, false) = false then
    raise exception 'Class reminders are not enabled for this account.' using errcode = '42501';
  end if;
  select p.division into v_division from public.profiles p where p.id = v_me;
  if v_division is null or upper(btrim(v_division)) not in
     ('A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R') then
    raise exception 'Add your division in Settings → Profile before enabling class reminders.' using errcode = '42501';
  end if;

  if p_endpoint is null or length(p_endpoint) not between 1 and 2000 or p_endpoint not like 'https://%' then
    raise exception 'Invalid push endpoint.' using errcode = '22023';
  end if;
  if p_p256dh is null or length(p_p256dh) not between 1 and 500 then
    raise exception 'Invalid push keys.' using errcode = '22023';
  end if;
  if p_auth is null or length(p_auth) not between 1 and 500 then
    raise exception 'Invalid push keys.' using errcode = '22023';
  end if;

  -- One endpoint, one owner: re-signing in (or switching accounts on the
  -- same browser) transfers the endpoint to the current profile and
  -- reactivates it, instead of creating a duplicate.
  insert into public.push_subscriptions (profile_id, endpoint, p256dh, auth, user_agent, is_active, failure_count)
  values (v_me, p_endpoint, p_p256dh, p_auth, left(coalesce(p_user_agent, ''), 500), true, 0)
  on conflict (endpoint) do update
    set profile_id = excluded.profile_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_agent = excluded.user_agent,
        is_active = true,
        failure_count = 0,
        last_error = null,
        updated_at = now()
  returning id into v_id;

  perform public.log_audit(
    'account.push_subscription_created', 'user', v_me::text,
    jsonb_build_object('endpoint_present', true),
    false, null, 'private'
  );
  return v_id;
end;
$$;

comment on function public.upsert_push_subscription(text, text, text, text) is
  'Creates or transfers a Web Push subscription for the signed-in profile. Ownership is derived from the session; the target profile is never accepted from the client. Requires an active student account with a valid division and the opt-in enabled.';

revoke all on function public.upsert_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.upsert_push_subscription(text, text, text, text) to authenticated, service_role;

create or replace function public.deactivate_push_subscription(p_endpoint text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := public.current_profile_id();
  v_count integer;
begin
  if v_me is null or p_endpoint is null then
    return false;
  end if;
  -- Ownership is checked here, not trusted from the client: only the
  -- current profile's own endpoint can be deactivated.
  update public.push_subscriptions
     set is_active = false, updated_at = now()
   where endpoint = p_endpoint and profile_id = v_me and is_active = true;
  get diagnostics v_count = row_count;
  if v_count > 0 then
    perform public.log_audit(
      'account.push_subscription_removed', 'user', v_me::text,
      jsonb_build_object('endpoint_present', true),
      false, null, 'private'
    );
  end if;
  return v_count > 0;
end;
$$;

comment on function public.deactivate_push_subscription(text) is
  'Deactivates one device subscription for the signed-in profile (logout / preference off). The endpoint must belong to the caller; another account''s endpoint is never touched.';

revoke all on function public.deactivate_push_subscription(text) from public, anon;
grant execute on function public.deactivate_push_subscription(text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 7. Live revocation triggers
-- ----------------------------------------------------------------------------

create or replace function public.on_profile_division_changed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- A division change (O → P) or removal (→ NULL) obsoletes every future
  -- reminder queued for the old division. The scheduler materialises the
  -- new set on its next run; the dispatcher re-checks before delivery, so
  -- no stale O reminder can fire after the change.
  if old.division is distinct from new.division then
    perform public.cancel_future_class_reminders(new.id);
  end if;
  return new;
end;
$$;

comment on function public.on_profile_division_changed() is
  'Cancels future class reminders when the profile division changes or is removed.';

drop trigger if exists profiles_division_reminder_guard on public.profiles;
create trigger profiles_division_reminder_guard
  after update of division on public.profiles
  for each row execute function public.on_profile_division_changed();

create or replace function public.on_profile_private_reminder_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Suspension / ban / deactivation stops future reminders and push.
  if new.account_status in ('suspended', 'banned', 'deactivated', 'deleted') then
    perform public.cancel_future_class_reminders(new.profile_id);
    update public.push_subscriptions
       set is_active = false, updated_at = now()
     where profile_id = new.profile_id and is_active = true;
  end if;
  -- Disabling the preference (by any path, not only the RPC) stops delivery.
  if new.class_reminder_popups = false
     and old.class_reminder_popups is distinct from false then
    perform public.cancel_future_class_reminders(new.profile_id);
    update public.push_subscriptions
       set is_active = false, updated_at = now()
     where profile_id = new.profile_id and is_active = true;
  end if;
  return new;
end;
$$;

comment on function public.on_profile_private_reminder_guard() is
  'Cancels future reminders and deactivates push when an account is suspended or the preference is disabled.';

drop trigger if exists profile_private_reminder_guard on public.profile_private;
create trigger profile_private_reminder_guard
  after update of account_status, class_reminder_popups on public.profile_private
  for each row execute function public.on_profile_private_reminder_guard();

-- Trigger functions are not callable by API roles.
revoke all on function public.on_profile_division_changed() from public, anon, authenticated;
revoke all on function public.on_profile_private_reminder_guard() from public, anon, authenticated;
select public.backup_sync_triggers();
