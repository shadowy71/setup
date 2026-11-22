# External accounts — deployment checklist

Automatic external user authentication and Visitor RBAC (migrations 080, 081 and 082).

**Read this before announcing visitor access.** The code and the database are
ready. One step below — the Google consent screen — is a dashboard switch that
nobody can flip from this repository, and until it is flipped **no external
account can be created in that deployment**. Everything else can be verified
without it.

---

## 0. Status

| Layer | State |
| --- | --- |
| Migrations 080, 081, 082 | **applied to production `eooysgxgvhbgohdmomji`** (2026-11-22), section by section, each verified |
| RLS / functions / triggers | complete; verified against the live project with real sessions, and by 24 SQL suites locally |
| Callback, session, permissions, admin UI, visitor notice | complete; 1,533 unit tests green, lint clean, build compiles |
| Google consent screen (External) | **manual — NOT applied** |
| Production Supabase project | migrations applied; **code not yet deployed** |

So the database half is live, and one genuine external sign-up
(`kartikgaikwad250@gmail.com`, 2026-11-22 12:21 UTC) was classified `visitor` by
the trigger with no client input.

**Visitor sign-in is still not a supported end-to-end journey**, because the
Google consent screen is Internal and the application code is not deployed. Do
not describe visitor access as available until §1 and the code deploy are done.

Note also that the migrations were applied by hand, so
`supabase_migrations.schema_migrations` has no rows for 080–082. `supabase db
push` would attempt to re-run them. They are idempotent, but back-fill the rows
(or land the next release through the CLI) so drift reporting is accurate.

---

## 1. Google Cloud Console (manual, ~5 minutes)

Google Cloud Console → *APIs & Services* → *OAuth consent screen*.

1. **User type must be `External`.** This is the step that matters. With
   `Internal`, only accounts inside the college Workspace tenant can authenticate
   at all: a personal Gmail address is rejected by Google before Supabase is ever
   contacted, so the classifier never runs and no visitor account can exist.
2. **Publishing status: `In production`.** In `Testing`, only the addresses listed
   under *Test users* (max 100, and they expire) can sign in, which is fine for a
   smoke test but not for real visitors.
3. **Scopes:** `openid`, `email`, `profile` — nothing else. These are
   non-sensitive, so no Google verification review is required. **Do not add a
   scope to make something work.** If a feature needs one, that is a design
   conversation, not a checkbox.
4. **Authorized domains** must include the production origin.
5. Leave *Authorized redirect URIs* alone: the Google-side redirect is
   `https://<project-ref>.supabase.co/auth/v1/callback`, owned by Supabase, not by
   Campus+. It is already correct if institutional sign-in works today.

> If the college's Workspace administrator will not allow an External consent
> screen, that policy is the blocker. Do not compensate by loosening domain
> checks in the database — institutional provisioning must stay tied to a
> verified address on a configured college domain.

## 2. Supabase (manual)

Supabase dashboard → **Authentication**:

1. **Providers → Google** — already enabled for institutional sign-in; nothing to
   change. Do not add scopes here either.
2. **Providers → Email** — keep **off**. Campus+ has no passwords and no codes;
   Google must stay the only way in, or an external visitor could create a
   password account and bypass Google's address verification entirely.
3. **URL configuration** — *Site URL* is the production origin;
   `https://<your-domain>/auth/callback` is in *Redirect URLs*. Already correct if
   institutional sign-in works today. PKCE stays on (the default).
4. **No auth hook, allow-list or "blocked email domains" entry may reject
   non-institutional addresses.** Check *Authentication → Attack Protection* and
   any Auth Hook configuration. If an operator previously hardened the project by
   adding a domain allow-list in the dashboard, it will silently defeat this
   feature — the classifier will never see the external address. The database is
   where classification belongs; the dashboard must not filter first.

## 3. Apply the migrations

Migrations are forward-only and additive. Neither one drops a table, a column or
a policy that institutional accounts rely on, and neither changes an existing
user's data.

```bash
npm run verify:db          # 82 migrations + 24 suites against throwaway Postgres
npm run db:bundle          # regenerates supabase/bundle/campus-plus-schema.sql
```

Apply by either route:

- **SQL editor** — paste `supabase/bundle/campus-plus-schema.sql` (the full
  schema; safe to re-run because every statement is idempotent), or
- **CLI** — `supabase db push`.

Then confirm the outcome, in the SQL editor:

```sql
-- Every existing account is institutional; none was silently reclassified.
select account_type, count(*) from public.profile_private group by 1;

-- The two new tables and the classifier exist.
select public.classify_institutional_email('someone@pccoepune.org');  -- institutional
select public.classify_institutional_email('someone@gmail.com');      -- external

-- Nothing was granted to anybody by the migration.
select count(*) from public.visitor_permission_grants;                -- 0

-- 082: the visitor's own fields exist, and no account holds the wrong pair.
select count(*) from information_schema.columns
 where table_schema = 'public' and table_name = 'profiles'
   and column_name in ('visitor_college_name', 'visitor_year');      -- 2

select count(*) from public.profiles p
  join public.profile_private pp on pp.profile_id = p.id
 where pp.account_type <> 'visitor'
   and (p.visitor_college_name is not null or p.visitor_year is not null);  -- 0

select count(*) from public.profiles p
  join public.profile_private pp on pp.profile_id = p.id
 where pp.account_type = 'visitor'
   and (p.branch is not null or p.year is not null or p.division is not null
        or p.show_branch_year);                                      -- 0

-- 082: exactly one complete_profile overload, the 9-argument one.
select pg_get_function_identity_arguments(p.oid)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'complete_profile';
```

Expected after a dry run on the existing data: every row `student`, 0 grants.

## 4. Environment variables

**No new variables are required.** `CAMPUS_ALLOWED_EMAIL_DOMAINS` keeps its value
and its meaning changes slightly: it is the deployment default for the domain
*classifier*, not a gate that rejects sign-in. `colleges.email_domains` is the
authoritative list at runtime.

## 5. Verify in production

1. Sign in with an institutional Google account → normal student experience; no
   visitor notice; `/admin` reachable for an administrator.
2. Sign in with a personal Google account → admitted, one visitor notice, no
   Create menu, `/campus/noticeboard` explains itself, `/settings` shows
   *Account type: Visitor*.
3. Refresh, and navigate between pages → the notice does not come back.
4. As an administrator: **Admin → External Users** lists the account with its
   email, role and granted permissions.
5. Grant *Create posts*, reload as the visitor → the Create menu offers Post, and
   a public post publishes. Revoke it, reload → the capability is gone
   immediately.
6. Confirm a visitor cannot reach `/admin`, `/moderator`, or read
   `/campus/noticeboard` notices.

## 6. Rollback

Forward-only, no destructive statements, so no rollback is needed for data
safety. If visitor sign-in must be withdrawn without a code change:

- set the Google consent screen back to `Internal` (new external sign-ins stop
  immediately; existing visitor sessions keep working until they expire), and/or
- suspend the individual accounts through the existing admin flows.

Removing the feature entirely would be a new forward migration (drop the grant
table, the visitor role and the classification helpers). Do not hand-delete rows
from `profile_private` — the `account_type` check constraint and the profile
relationships depend on them.
