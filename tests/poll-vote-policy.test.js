import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The poll insert RLS policy must let the poll's author vote like any other
 * eligible student, while keeping every other guard: self-vote only, active
 * account, published open poll, and no voting on a blocked author's poll.
 * Duplicate votes stay impossible via the unique (post_id, user_id) constraint.
 *
 * These read the shipped schema sources so a future edit cannot silently
 * re-introduce an author-specific voting restriction.
 */

const ROOT = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

const BUNDLE = 'supabase/bundle/campus-plus-schema.sql';
const MIGRATION = 'supabase/migrations/20261102000001_039_poll_author_may_vote.sql';

function insertPolicyBody(sql) {
  // The bundle carries the entire migration history, so the policy is defined
  // more than once. The last definition is the one a fresh install ends with.
  const matches = [...sql.matchAll(/create policy poll_votes_insert_self on public\.poll_votes([\s\S]*?);/g)];
  expect(matches.length, 'poll_votes_insert_self policy must exist').toBeGreaterThan(0);
  return matches.at(-1)[1];
}

describe('poll_votes_insert_self RLS policy', () => {
  for (const source of [BUNDLE, MIGRATION]) {
    it(`${source}: no author-specific voting restriction`, () => {
      const body = insertPolicyBody(read(source));
      expect(body).not.toMatch(/author_id\s*<>\s*public\.current_profile_id\(\)/);
      expect(body).not.toMatch(/author_id\s*!=/);
    });

    it(`${source}: keeps self-vote, active-account, open-poll and block guards`, () => {
      const body = insertPolicyBody(read(source));
      expect(body).toContain('user_id = public.current_profile_id()');
      expect(body).toContain('public.is_active_user()');
      expect(body).toContain("p.kind = 'poll'");
      expect(body).toContain("p.status = 'published'");
      expect(body).toMatch(/poll_closes_at is null or p\.poll_closes_at > now\(\)/);
      expect(body).toContain('public.is_blocked_with_current(p2.author_id)');
    });
  }

  it('one vote per user remains enforced by a unique constraint', () => {
    expect(read(BUNDLE)).toMatch(/unique \(post_id, user_id\)/);
  });

  it('the frontend does not disable voting for the post owner', () => {
    const card = read('components/posts/PostCard.js');
    // canVote depends only on being signed in — never on authorship.
    expect(card).toContain('canVote={Boolean(currentUserId)}');
    const pollBlock = read('components/posts/PollBlock.js');
    expect(pollBlock).not.toMatch(/author_id/);
  });
});
