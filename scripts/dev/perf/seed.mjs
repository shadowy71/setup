#!/usr/bin/env node
/**
 * Deterministic fixture data for the local performance harness.
 *
 * The volumes are deliberately "small pilot" sized — a couple of students with
 * a few hundred rows each — because that is the situation the app has to be
 * fast in. Identical seeds on every run mean before/after numbers are
 * comparable.
 *
 * Everything is inserted as the `postgres` superuser, which is exactly how
 * `supabase db push` + the secret-key operator scripts behave: RLS is skipped
 * for writes, but the schema, triggers and constraints are the real ones.
 */

export const PASSWORD = 'perf-password';
export const STUDENT_EMAIL = 'perf.student1@pccoepune.org';
export const ADMIN_EMAIL = 'perf.admin@pccoepune.org';
export const MODERATOR_EMAIL = 'perf.mod@pccoepune.org';

const STUDENTS = [
  ['perf.student1@pccoepune.org', 'Aarav Patil', 'aarav_p'],
  ['perf.student2@pccoepune.org', 'Meera Joshi', 'meera_j'],
  ['perf.student3@pccoepune.org', 'Kabir Shah', 'kabir_s'],
  ['perf.student4@pccoepune.org', 'Isha Rao', 'isha_r'],
  ['perf.student5@pccoepune.org', 'Rohan Desai', 'rohan_d'],
  ['perf.student6@pccoepune.org', 'Neha Kulkarni', 'neha_k'],
  ['perf.student7@pccoepune.org', 'Vivaan Mehta', 'vivaan_m'],
  ['perf.student8@pccoepune.org', 'Ananya Nair', 'ananya_n'],
  ['perf.student9@pccoepune.org', 'Dev Chavan', 'dev_c'],
  ['perf.student10@pccoepune.org', 'Sara Fernandes', 'sara_f'],
];

const STAFF = [
  [MODERATOR_EMAIL, 'Moderator (perf)', 'perf_moderator', 'moderator'],
  [ADMIN_EMAIL, 'Administrator (perf)', 'perf_admin', 'super_admin'],
];

async function asUser(client, authUserId, sql, params = []) {
  await client.query('select set_config($1, $2, false)', ['request.jwt.claim.sub', authUserId]);
  await client.query('select set_config($1, $2, false)', ['request.jwt.claim.role', 'authenticated']);
  const result = await client.query(sql, params);
  await client.query('select set_config($1, $2, false)', ['request.jwt.claim.sub', '']);
  await client.query('select set_config($1, $2, false)', ['request.jwt.claim.role', '']);
  return result;
}

export async function seedFixtures(client) {
  /* ---------------------------------------------------------------- users */
  const users = [];
  for (const [email, displayName, username] of [...STUDENTS, ...STAFF]) {
    const { rows } = await client.query(
      `insert into auth.users (email, encrypted_password, raw_user_meta_data, created_at, last_sign_in_at)
       values ($1, $2, $3, now() - interval '60 days', now() - interval '2 hours')
       returning id`,
      [email, PASSWORD, JSON.stringify({ display_name: displayName })],
    );
    const authId = rows[0].id;
    const { rows: privateRows } = await client.query(
      `select profile_id from public.profile_private where auth_user_id = $1`,
      [authId],
    );
    const profileId = privateRows[0].profile_id;
    await asUser(client, authId, `select public.complete_profile($1, $2, $3, $4, $5, $6, $7)`, [
      username,
      displayName,
      `Second year ${username.endsWith('admin') ? 'nothing' : 'CSE'} student at PCCOE.`,
      'Computer Engineering',
      'SE',
      'A',
      true,
    ]);
    users.push({ email, username, displayName, authId, profileId });
  }
  for (const [email, , , role] of STAFF) {
    const user = users.find((u) => u.email === email);
    await client.query(`select public.grant_role($1, $2)`, [user.profileId, role]);
  }
  const me = users[0];
  const admin = users.find((u) => u.email === ADMIN_EMAIL);
  const authorIds = users.filter((u) => !u.username.startsWith('perf_')).map((u) => u.profileId);

  /* --------------------------------------------------------- communities */
  const communitySlugs = [
    'computer-engineering',
    'campus-general',
    'hostel-life',
    'placements-2027',
    'data-structures-study-group',
    'dbms-study-group',
    'coding-club',
    'team-automatons',
  ];
  await client.query(
    `insert into public.communities (kind, name, slug, description, subject, club_category, recruitment_info, visibility, join_policy, status, is_official, created_by, created_at)
     select kind::public.community_kind, name, slug, description, subject, club_category, recruitment_info,
            'public'::public.visibility_level, 'open', 'published'::public.content_status, is_official,
            ($1::uuid[])[creator_idx], now() - (interval '1 day' * age_days)
     from (values
       ('community', 'Computer Engineering', 'computer-engineering', 'Everything CSE: labs, deadlines, notes and placement chatter.', 'Computer Engineering', null, null, false, 1, 40),
       ('community', 'Campus General', 'campus-general', 'The everything-else community for PCCOE students.', null, null, null, false, 2, 60),
       ('community', 'Hostel Life', 'hostel-life', 'Mess timings, laundry, room allotments and late-night chai.', null, null, null, false, 3, 55),
       ('community', 'Placements 2027', 'placements-2027', 'Drives, referrals, resumes and interview experiences.', null, null, null, true, 4, 30),
       ('study_group', 'Data Structures Study Group', 'data-structures-study-group', 'Weekly DS sessions before the lab exam.', 'Data Structures', null, null, false, 5, 25),
       ('study_group', 'DBMS Study Group', 'dbms-study-group', 'Normalisation, transactions and past papers.', 'DBMS', null, null, false, 6, 22),
       ('club', 'Coding Club', 'coding-club', 'Hackathons, competitive programming and open source.', 'Competitive programming', 'Technical', 'Recruiting first and second year coders.', true, 7, 90),
       ('club', 'Team Automatons', 'team-automatons', 'Robotics and automation collegiate team.', 'Robotics and automation', 'Technical', null, true, 8, 80)
     ) as c(kind, name, slug, description, subject, club_category, recruitment_info, is_official, creator_idx, age_days)
     on conflict (slug) do nothing`,
    [authorIds.slice(0, 8)],
  );
  // Migration 032 already owns the catalogue rows. Reuse them without
  // overwriting their curated profiles, sources or verification state.
  const { rows: communityRows } = await client.query(
    `select id, kind, name, slug from public.communities
     where slug = any($1::text[])
     order by array_position($1::text[], slug)`,
    [communitySlugs],
  );
  for (const [index, community] of communityRows.entries()) {
    await client.query(
      `insert into public.community_members (community_id, user_id, role, status, joined_at)
       select $1, uid, 'member'::public.community_role, 'active', now() - interval '10 days'
       from unnest($2::uuid[]) as uid
       on conflict do nothing`,
      [community.id, authorIds.slice(0, 4 + (index % 5))],
    );
    await client.query(
      `update public.communities set member_count = (select count(*) from public.community_members m where m.community_id = $1 and m.status = 'active') where id = $1`,
      [community.id],
    );
  }
  // Exercise the real protected assignment path so the signed-in preview
  // student can open club management with an actual owner membership.
  const codingClub = communityRows.find((community) => community.slug === 'coding-club');
  await asUser(client, admin.authId, `select public.assign_club_admin($1, $2)`, [codingClub.id, me.username]);

  await client.query(
    `insert into public.community_join_requests (community_id, user_id, message, status, created_at)
     select $1, $2, 'I would like to join this community.', 'pending', now() - interval '3 days'`,
    [communityRows[3].id, users[9].profileId],
  );

  /* ---------------------------------------------------------------- posts */
  await client.query(
    `insert into public.posts (author_id, kind, title, body, community_id, visibility, status, created_at, updated_at)
     select
       (array[$1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10])[1 + (i % 10)],
       (array['post','post','discussion','post','poll','post','discussion','post'])[1 + (i % 8)]::public.post_kind,
       case when (i % 8 in (2, 6, 4)) or (i % 3 = 0) then 'Campus update #' || i else null end,
       case
         when i % 8 = 4 then 'Which elective should we pick this semester? Vote below.'
         when i % 5 = 0 then 'Sharing my notes for unit ' || (1 + (i % 5)) || '. Hope it helps someone before the internals. Ask questions in the comments and I will answer.'
         when i % 5 = 1 then 'The lab machines were updated today. If you were waiting on the slow build, it is much better now.'
         when i % 5 = 2 then 'Anyone else stuck on question ' || (i % 9 + 1) || ' of the assignment? Posting what I have so far.'
         when i % 5 = 3 then 'Lost my ID card near the canteen. If you find it, please reply here instead of DMing me.'
         else 'Library timings change from Monday — 8am to 10pm during the exam weeks.'
       end,
       case when i % 4 = 0 then (array[$11::uuid, $12, $13, $14, $15, $16, $17, $18])[1 + (i % 8)] else null end,
       'public'::public.visibility_level,
       'published'::public.content_status,
       now() - (interval '20 minutes' * i),
       now() - (interval '20 minutes' * i)
     from generate_series(1, 240) as i`,
    [
      ...authorIds, ...communityRows.slice(0, 8).map((c) => c.id),
    ],
  );

  // Poll options for the poll posts.
  await client.query(
    `insert into public.poll_options (post_id, label, position)
     select p.id, option, ordinality::int
     from public.posts p
     cross join lateral unnest(array['Machine Learning', 'Cloud Computing', 'Cyber Security', 'Mobile Development']) with ordinality as o(option, ordinality)
     where p.kind = 'poll'`,
  );
  await client.query(
    `insert into public.poll_votes (post_id, option_id, user_id, created_at)
     select o.post_id, o.id, u.uid, now() - interval '1 hour'
     from public.poll_options o
     join lateral unnest($1::uuid[]) with ordinality as u(uid, ord) on true
     where o.position = 1 + (u.ord % 2)
     on conflict do nothing`,
    [authorIds.slice(0, 6)],
  );

  await client.query(
    `insert into public.comments (post_id, author_id, body, status, created_at)
     select p.id, (array[$1::uuid, $2, $3, $4, $5, $6])[1 + (i % 6)], 'Comment ' || i || ': ' ||
            (array['good point','thanks for sharing','that helped','same here','see you there','please share the link'])[1 + (i % 6)],
            'published'::public.content_status, p.created_at + (interval '7 minutes' * i)
     from (select id, created_at from public.posts order by created_at desc limit 120) p
     cross join generate_series(1, 6) as i`,
    authorIds.slice(0, 6),
  );

  await client.query(
    `insert into public.reactions (user_id, target_type, target_id, kind, created_at)
     select $1, 'post', p.id, (array['like','helpful','insightful','celebrate','thanks'])[1 + (i % 5)]::public.reaction_kind, now() - interval '1 hour'
     from (select id from public.posts order by created_at desc limit 200) p
     cross join generate_series(1, 6) as i
     on conflict do nothing`,
    [me.profileId],
  );

  await client.query(
    `update public.posts p set
       comment_count = (select count(*) from public.comments c where c.post_id = p.id and c.status = 'published'),
       reaction_count = (select count(*) from public.reactions r where r.target_type = 'post' and r.target_id = p.id)`,
  );
  await client.query(
    `update public.poll_options o set vote_count = (select count(*) from public.poll_votes v where v.option_id = o.id)`,
  );
  await client.query(
    `update public.communities c set post_count = (select count(*) from public.posts p where p.community_id = c.id and p.status = 'published')`,
  );

  /* ---------------------------------------------------------- marketplace */
  const { rows: categoryRows } = await client.query(`select id from public.marketplace_categories where scope = 'marketplace' order by sort_order`);
  await client.query(
    `insert into public.marketplace_listings (seller_id, category_id, title, description, price, is_free, condition, location, status, created_at, updated_at)
     select (array[$1::uuid, $2, $3, $4, $5])[1 + (i % 5)],
            (array[$6::uuid, $7, $8, $9])[1 + (i % 4)],
            (array['Scientific calculator','Drafter set','Engineering graphics kit','Mini drafter','Reference book: DBMS','Laptop stand','Wireless mouse','Study lamp'])[1 + (i % 8)] || ' #' || i,
            'Used for one semester, in good condition. Meet near the main gate or the library.',
            case when i % 7 = 0 then null else 100 + (i * 25) end,
            (i % 7 = 0),
            (array['good','like_new','fair','not_applicable'])[1 + (i % 4)]::public.item_condition,
            'PCCOE campus',
            (array['active','active','active','pending','active','sold','hidden'])[1 + (i % 7)]::public.listing_status,
            now() - (interval '3 hours' * i),
            now() - (interval '3 hours' * i)
     from generate_series(1, 90) as i`,
    [
      ...authorIds.slice(0, 5), ...categoryRows.slice(0, 4).map((c) => c.id),
    ],
  );
  await client.query(
    `insert into public.gigs (creator_id, title, description, category, skills, payment_type, compensation,
                              availability, deadline, contact_details, state, status, created_at)
     select (array[$1::uuid, $2, $3, $4])[1 + (i % 4)], 'Gig: poster design ' || i,
            'Need a poster for the club event by Friday. Text me for the details.',
            (array['design','coding','tutoring','editing'])[1 + (i % 4)],
            (case (i % 4)
               when 0 then array['Design','Figma']::text[]
               when 1 then array['Coding','React']::text[]
               when 2 then array['Calculus','Physics']::text[]
               else array['Editing','Writing']::text[]
             end),
            (case when i % 3 = 0 then 'unpaid' else 'paid' end),
            '500-' || (500 + i * 100) || ' per task', 'Weekends',
            current_date + (i % 20),
            'Send a sample of your work and your branch.',
            (case when i % 7 = 0 then 'closed' else 'open' end)::public.gig_state,
            'published'::public.content_status, now() - (interval '6 hours' * i)
     from generate_series(1, 12) as i`,
    authorIds.slice(0, 4),
  );
  await client.query(
    `insert into public.campus_deals (title, description, merchant, discount_details, valid_from, valid_until, status, is_official, created_by, published_at, created_at)
     select 'Campus deal ' || i, 'Student discount near campus.', (array['Cafe Canteen','Copy Corner','Book Depot'])[1 + (i % 3)],
            (array['10% off','20 rupees off','Buy 1 get 1'])[1 + (i % 3)], current_date, current_date + 30,
            'published'::public.content_status, true, $1, now() - (interval '1 day' * i), now() - (interval '1 day' * i)
     from generate_series(1, 6) as i`,
    [users[11].profileId],
  );

  /* ------------------------------------------------------------ messaging */
  const conversations = [];
  for (let i = 0; i < 6; i += 1) {
    const other = users[1 + i];
    const { rows } = await client.query(
      `insert into public.conversations (kind, direct_key, created_by, status, last_message_at, created_at)
       values ('direct', least($1::text, $2::text) || ':' || greatest($1::text, $2::text), $1::uuid, 'published', now(), now() - interval '20 days')
       returning id`,
      [me.profileId, other.profileId],
    );
    conversations.push(rows[0].id);
  }
  const { rows: groupRows } = await client.query(
    `insert into public.conversations (kind, title, community_id, created_by, status, last_message_at, created_at)
     values ('group', 'Computer Engineering', $1::uuid, $2::uuid, 'published', now(), now() - interval '30 days')
     returning id`,
    [communityRows[0].id, me.profileId],
  );
  conversations.push(groupRows[0].id);

  for (const [index, conversationId] of conversations.entries()) {
    const participants = index === conversations.length - 1 ? authorIds.slice(0, 6) : [me.profileId, users[1 + index].profileId];
    await client.query(
      `insert into public.conversation_members (conversation_id, user_id, role, status, joined_at, last_read_at)
       select $1, uid, 'member', 'active', now() - interval '20 days', now() - interval '3 hours'
       from unnest($2::uuid[]) as uid
       on conflict do nothing`,
      [conversationId, participants],
    );
    await client.query(
      `insert into public.messages (conversation_id, sender_id, body, status, created_at)
       select $1, (array[$2::uuid, $3])[1 + (i % 2)], 'Message ' || i || ' in this thread — ' ||
              (array['are you coming to the lab?','check the notice once','I shared the notes','see you at 4',
                     'the deadline moved to Friday','thanks!'])[1 + (i % 6)],
              'published'::public.content_status, now() - (interval '11 minutes' * (60 - i))
       from generate_series(1, 60) as i`,
      [conversationId, participants[0], participants[participants.length - 1]],
    );
    await client.query(
      `insert into public.message_reads (conversation_id, user_id, last_read_at)
       select $1, uid, now() - interval '4 hours' from unnest($2::uuid[]) as uid
       on conflict do nothing`,
      [conversationId, participants],
    );
    await client.query(
      `update public.conversations set last_message_at = (select max(created_at) from public.messages where conversation_id = $1) where id = $1`,
      [conversationId],
    );
  }

  /* -------------------------------------------------------- notifications */
  await client.query(
    `insert into public.notifications (recipient_id, actor_id, type, title, body, reference_type, reference_id, url, read_at, created_at)
     select $1, (array[$2::uuid, $3, $4])[1 + (i % 3)],
            (array['comment','reply','mention','reaction','marketplace_status'])[1 + (i % 5)]::public.notification_type,
            'Notification ' || i,
            'Someone interacted with your post on the campus feed.',
            'post', 'post', '/notifications',
            case when i % 4 = 0 then null else now() - interval '1 hour' end,
            now() - (interval '25 minutes' * i)
     from generate_series(1, 140) as i`,
    [me.profileId, users[1].profileId, users[2].profileId, users[3].profileId],
  );

  /* ----------------------------------------------------- official content */
  await client.query(
    `insert into public.notices (title, body, category, importance, pinned, expires_at, status, created_by, updated_by, published_at, created_at)
     select 'Notice ' || i || ': ' || (array['library timings','exam schedule','fee payment','bus routes','holiday','lab maintenance'])[1 + (i % 6)],
            'The official details for notice ' || i || '. Please read the full notice and plan accordingly. Contact the office for clarifications.',
            (array['general','academic','important','event'])[1 + (i % 4)]::public.notice_category,
            (array['normal','high','critical'])[1 + (i % 3)],
            (i % 20 = 0),
            case when i % 9 = 0 then now() - interval '2 days' else now() + interval '20 days' end,
            (array['published','published','published','draft'])[1 + (i % 4)]::public.content_status,
            $1, $1,
            case when i % 4 = 0 then null else now() - (interval '2 days' * i) end,
            now() - (interval '2 days' * i)
     from generate_series(1, 60) as i`,
    [users[11].profileId],
  );
  await client.query(
    `update public.notices set published_at = created_at where status = 'published' and published_at is null`,
  );
  await client.query(
    `insert into public.events (title, description, starts_on, ends_on, start_time, end_time, location, organizer, capacity, status, is_official, created_by, published_at, created_at)
     select 'Event ' || i || ': ' || (array['hackathon','workshop','seminar','sports meet','club meet','placement drive'])[1 + (i % 6)],
            'Full event description with the agenda, what to bring and who can attend.',
            current_date + i, current_date + i, '10:00', '16:00',
            (array['Auditorium','Seminar Hall','Ground','Lab 3'])[1 + (i % 4)], 'Student Council', 120,
            'published'::public.event_status, true, $1, now() - interval '5 days', now() - interval '6 days'
     from generate_series(1, 6) as i`,
    [users[11].profileId],
  );
  await client.query(
    `insert into public.event_registrations (event_id, user_id, status, created_at)
     select e.id, (array[$1::uuid, $2, $3, $4])[1 + (u % 4)], 'going', now() - interval '2 days'
     from (select id from public.events where status = 'published' order by starts_on limit 8) e
     cross join generate_series(1, 3) as u
     on conflict do nothing`,
    [me.profileId, users[1].profileId, users[2].profileId, users[3].profileId],
  );
  await client.query(
    `insert into public.official_resources (title, description, url, branch, year, semester, subject, type, is_official, status, created_by, approved_by, published_at, created_at)
     select 'Resource ' || i, 'Notes and reference material for the semester.', 'https://example.invalid/resource/' || i,
            'Computer Engineering', 'SE', 'III', 'Subject ' || (i % 8), (array['notes','paper','reference'])[1 + (i % 3)],
            true, 'published'::public.content_status, $1, $1, now() - (interval '3 days' * i), now() - (interval '3 days' * i)
     from generate_series(1, 24) as i`,
    [users[11].profileId],
  );
  await client.query(
    `insert into public.opportunities (title, organization, description, eligibility, deadline, url, location, mode, source, status, created_by, published_at, created_at)
     select 'Opportunity ' || i, 'Company ' || i, 'Internship and placement opportunity details.', 'Third and final year students',
            current_date + (i * 3), 'https://example.invalid/job/' || i, 'Pune', (array['onsite','remote','hybrid'])[1 + (i % 3)],
            (array['official','community'])[1 + (i % 2)]::public.opportunity_source, 'published'::public.content_status,
            $1, now() - (interval '2 days' * i), now() - (interval '2 days' * i)
     from generate_series(1, 18) as i`,
    [users[11].profileId],
  );
  await client.query(
    `insert into public.projects (creator_id, title, description, technologies, repo_url, status, reaction_count, created_at)
     select (array[$1::uuid, $2, $3, $4])[1 + (i % 4)], 'Project ' || i, 'A student project built for the campus.',
            array['Next.js','Supabase','PostgreSQL'], 'https://example.invalid/repo/' || i, 'published'::public.content_status,
            i % 7, now() - (interval '4 days' * i)
     from generate_series(1, 20) as i`,
    authorIds.slice(0, 4),
  );
  await client.query(
    `insert into public.lost_found (kind, title, description, location, occurred_on, status, creator_id, created_at)
     select (array['lost','found'])[1 + (i % 2)]::public.lost_found_kind, 'Item ' || i,
            'Description of the item and where it was last seen.', 'Canteen', current_date - i,
            'published'::public.content_status, (array[$1::uuid, $2, $3])[1 + (i % 3)], now() - (interval '1 day' * i)
     from generate_series(1, 22) as i`,
    authorIds.slice(0, 3),
  );
  await client.query(
    `insert into public.housing_posts (title, description, area, budget, room_type, available_from, status, creator_id, created_at)
     select 'Housing ' || i, 'Room available near campus with basic furniture.', 'Nigdi', 4500 + (i * 250),
            (array['single','shared','pg','flat'])[1 + (i % 4)]::public.room_type, current_date + i,
            'published'::public.content_status, (array[$1::uuid, $2])[1 + (i % 2)], now() - (interval '2 days' * i)
     from generate_series(1, 16) as i`,
    authorIds.slice(0, 2),
  );
  await client.query(
    `insert into public.ride_posts (origin, destination, ride_date, ride_time, description, seats, status, creator_id, created_at)
     select 'PCCOE', (array['Pune Station','Wakad','Hinjawadi','Swargate'])[1 + (i % 4)], current_date + i, '18:30',
            'Sharing a cab, split the fare.', 3, 'published'::public.content_status,
            (array[$1::uuid, $2])[1 + (i % 2)], now() - (interval '1 day' * i)
     from generate_series(1, 14) as i`,
    authorIds.slice(0, 2),
  );
  await client.query(
    `insert into public.team_posts (creator_id, project_name, description, required_skills, team_size, deadline, status, created_at)
     select (array[$1::uuid, $2, $3])[1 + (i % 3)], 'Hackathon team ' || i, 'Looking for teammates for the upcoming hackathon.',
            array['React','Python'], 4, current_date + (i + 5), 'published'::public.content_status, now() - (interval '1 day' * i)
     from generate_series(1, 12) as i`,
    authorIds.slice(0, 3),
  );

  /* ------------------------------------------------- moderation & audit */
  await client.query(
    `insert into public.reports (reporter_id, target_type, target_id, reason, details, status, created_at)
     select (array[$1::uuid, $2, $3])[1 + (i % 3)], 'post',
            (select id from public.posts order by created_at desc offset i limit 1),
            (array['spam','harassment','privacy','misinformation'])[1 + (i % 4)],
            'Reported from the post actions menu.', (array['pending','reviewing','resolved'])[1 + (i % 3)]::public.report_status,
            now() - (interval '4 hours' * i)
     from generate_series(1, 14) as i`,
    [users[1].profileId, users[2].profileId, users[3].profileId],
  );
  await client.query(
    `insert into public.audit_logs (actor_user_id, action, target_type, target_id, metadata, visibility, created_at)
     select (array[$1::uuid, $2])[1 + (i % 2)],
            (array['admin.setting_changed','moderation.content_hidden','admin.role_granted','moderation.report_resolved'])[1 + (i % 4)],
            'post', (select id from public.posts order by created_at desc offset i limit 1),
            jsonb_build_object('source', 'perf-seed', 'index', i), 'staff', now() - (interval '2 hours' * i)
     from generate_series(1, 60) as i`,
    [users[10].profileId, users[11].profileId],
  );
  await client.query(
    `insert into public.moderation_actions (moderator_id, target_type, target_id, action, new_status, note, created_at)
     select $1, 'post', (select id from public.posts order by created_at desc offset i limit 1),
            'hide', 'hidden', 'Off-topic for this community.', now() - (interval '5 hours' * i)
     from generate_series(1, 25) as i`,
    [users[10].profileId],
  );

  /* --------------------------------------------------------------- blocks */
  await client.query(`insert into public.blocks (blocker_id, blocked_id, reason) values ($1, $2, 'Testing block behaviour')`, [
    me.profileId,
    users[9].profileId,
  ]);

  return {
    users,
    me,
    admin: users.find((u) => u.email === ADMIN_EMAIL),
    moderator: users.find((u) => u.email === MODERATOR_EMAIL),
    communities: communityRows,
  };
}
