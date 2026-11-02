-- =============================================================================
-- Campus+ migration 039 — let a poll's author vote in their own poll
-- =============================================================================
-- The poll_votes_insert_self policy carried `p.author_id <> current_profile_id()`,
-- which silently rejected the poll creator's own vote. That is not an intentional
-- product rule: the one-vote-per-user unique constraint, the active-account check,
-- the published-and-open poll check and the block check all stay in force. Only the
-- author-specific exclusion is removed, so the creator participates like any other
-- eligible student.
--
-- No table shape changes; only the insert policy is recreated. Delete/select
-- policies, triggers and grants are untouched.
-- =============================================================================

drop policy if exists poll_votes_insert_self on public.poll_votes;

create policy poll_votes_insert_self on public.poll_votes
  for insert to authenticated
  with check (
    user_id = public.current_profile_id()
    and public.is_active_user()
    and exists (
      select 1 from public.posts p
      where p.id = post_id
        and p.kind = 'poll'
        and p.status = 'published'
        and (p.poll_closes_at is null or p.poll_closes_at > now())
    )
    and not exists (
      select 1 from public.posts p2
      where p2.id = post_id and public.is_blocked_with_current(p2.author_id)
    )
  );

comment on policy poll_votes_insert_self on public.poll_votes is
  'Any active student may vote once in an open published poll, including the poll author; duplicates remain blocked by the unique (post_id, user_id) constraint.';
