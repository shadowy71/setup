-- Campus+ migration 032 — source-backed club catalogue
-- =============================================================================
-- Reconciles the supplied organization roster with the existing communities
-- table. The supplied roster contains 35 unique entries including Campus+.
-- No administrators, members, events, logos, contact details or endorsements
-- are fabricated. Newly imported rows remain unassigned until a real active
-- Campus+ account is selected through assign_club_admin().
--
-- Re-running is safe. Existing names, descriptions, categories, images,
-- settings and memberships are never overwritten by this seed.
-- =============================================================================

create temporary table club_catalogue_seed (
  catalogue_key text primary key,
  name text not null,
  slug text not null,
  club_category text not null,
  organization_type text not null,
  description text not null,
  aliases text not null default '',
  source_label text,
  source_url text,
  verification_status text not null
) on commit drop;

insert into club_catalogue_seed values
-- PCCOE collegiate clubs and teams (official collegiate-club directory)
('team-red-baron', 'Team Red Baron', 'team-red-baron', 'Technical', 'collegiate_team',
 'PCCOE collegiate team listed for ATV and SAE Baja work. Current recruitment and contact details are pending club administrator review.',
 'Red Baron', 'PCCOE collegiate clubs', 'https://www.pccoepune.com/pccoe-collegiate-clubs.php', 'source_checked'),
('team-kratos-racing-electric', 'Team Kratos Racing Electric', 'team-kratos-racing-electric', 'Technical', 'collegiate_team',
 'PCCOE Formula Student initiative listed in the collegiate-club directory. Current recruitment and contact details are pending club administrator review.',
 'Kratos Racing|Team Kratos|Kratos Racing Electric', 'PCCOE collegiate clubs', 'https://www.pccoepune.com/pccoe-collegiate-clubs.php', 'source_checked'),
('team-solarium', 'Team Solarium', 'team-solarium', 'Technical', 'collegiate_team',
 'PCCOE collegiate team listed for solar-car work. Current recruitment and contact details are pending club administrator review.',
 'Solarium', 'PCCOE collegiate clubs', 'https://www.pccoepune.com/pccoe-collegiate-clubs.php', 'source_checked'),
('team-ambush', 'Team Ambush', 'team-ambush', 'Technical', 'collegiate_team',
 'PCCOE collegiate team associated in the official directory with an automated multi-vegetable transplanter. Current club details are pending administrator review.',
 'Ambush', 'PCCOE collegiate clubs', 'https://www.pccoepune.com/pccoe-collegiate-clubs.php', 'source_checked'),
('team-automatons', 'Team Automatons', 'team-automatons', 'Technical', 'collegiate_team',
 'PCCOE collegiate team listed for robotics and automation. Current recruitment and contact details are pending club administrator review.',
 'Automatons', 'PCCOE collegiate clubs', 'https://www.pccoepune.com/pccoe-collegiate-clubs.php', 'source_checked'),
('team-maverick-india', 'Team Maverick India', 'team-maverick-india', 'Technical', 'collegiate_team',
 'Listed in PCCOE''s collegiate-club directory. Activities, recruitment, and contact details are pending club administrator review.',
 'Maverick India|Team Maverick', 'PCCOE collegiate clubs', 'https://www.pccoepune.com/pccoe-collegiate-clubs.php', 'source_checked'),
('team-anantam', 'Team Anantam', 'team-anantam', 'Technical', 'collegiate_team',
 'Listed in PCCOE''s collegiate-club directory. Activities, recruitment, and contact details are pending club administrator review.',
 'Anantam', 'PCCOE collegiate clubs', 'https://www.pccoepune.com/pccoe-collegiate-clubs.php', 'source_checked'),
('coding-club', 'Coding Club', 'coding-club', 'Technical', 'technical_club',
 'Listed in PCCOE''s collegiate-club directory. Current activities, recruitment, and contact details are pending club administrator review.',
 'PCCOE Coding Club', 'PCCOE collegiate clubs', 'https://www.pccoepune.com/pccoe-collegiate-clubs.php', 'source_checked'),

-- Computing and developer communities requested for the directory
('devcorps', 'DEVCORPS', 'devcorps', 'Technical', 'computing_community',
 'Included in the requested Campus+ organization catalogue. A public source, current activities, and contact details are pending verification.',
 '', null, null, 'pending'),
('cybsec', 'CybSec', 'cybsec', 'Technical', 'computing_community',
 'Included in the requested Campus+ organization catalogue. A public source, current activities, and contact details are pending verification.',
 'Cyber Security Club', null, null, 'pending'),
('foss', 'FOSS', 'foss', 'Technical', 'computing_community',
 'Included in the requested Campus+ organization catalogue. A public source, current activities, and contact details are pending verification.',
 'Free and Open Source Software|FOSS Club', null, null, 'pending'),
('gdg-campus', 'GDG Campus', 'gdg-campus', 'Technical', 'computing_community',
 'PCCOE''s directory links to the Google developer student community under its earlier GDSC naming. Current branding and club details are pending administrator review.',
 'GDSC|GDGC|GDG on Campus|Google Developer Student Clubs|Google Developer Groups on Campus', 'PCCOE student associations', 'https://www.pccoepune.com/student-association.php', 'source_checked'),

-- Department student associations (official student-association directory)
('cesa', 'CESA', 'cesa', 'Technical', 'department_association',
 'Department student association listed by PCCOE. Current activities, leadership, and contact details are pending club administrator review.',
 'Computer Engineering Students Association', 'PCCOE student associations', 'https://www.pccoepune.com/student-association.php', 'source_checked'),
('mesa', 'MESA', 'mesa', 'Technical', 'department_association',
 'Department student association listed by PCCOE. Current activities, leadership, and contact details are pending club administrator review.',
 'Mechanical Engineering Students Association', 'PCCOE student associations', 'https://www.pccoepune.com/student-association.php', 'source_checked'),
('etsa', 'ETSA', 'etsa', 'Technical', 'department_association',
 'Department student association listed by PCCOE. Current activities, leadership, and contact details are pending club administrator review.',
 'Electronics and Telecommunication Students Association', 'PCCOE student associations', 'https://www.pccoepune.com/student-association.php', 'source_checked'),
('ciesa', 'CiESA', 'ciesa', 'Technical', 'department_association',
 'Department student association listed by PCCOE. Current activities, leadership, and contact details are pending club administrator review.',
 'Civil Engineering Students Association', 'PCCOE student associations', 'https://www.pccoepune.com/student-association.php', 'source_checked'),
('itsa', 'ITSA', 'itsa', 'Technical', 'department_association',
 'Department student association listed by PCCOE. Current activities, leadership, and contact details are pending club administrator review.',
 'Information Technology Students Association', 'PCCOE student associations', 'https://www.pccoepune.com/student-association.php', 'source_checked'),
('aimsa', 'AiMSA', 'aimsa', 'Technical', 'department_association',
 'Department student association listed by PCCOE. Current activities, leadership, and contact details are pending club administrator review.',
 'AI and ML Students Association', 'PCCOE student associations', 'https://www.pccoepune.com/student-association.php', 'source_checked'),
('cresa', 'CRESA', 'cresa', 'Technical', 'department_association',
 'Department student association listed by PCCOE. Current activities, leadership, and contact details are pending club administrator review.',
 '', 'PCCOE student associations', 'https://www.pccoepune.com/student-association.php', 'source_checked'),
('mcasa', 'MCASA', 'mcasa', 'Technical', 'department_association',
 'Department student association listed by PCCOE. Current activities, leadership, and contact details are pending club administrator review.',
 'MCA Students Association', 'PCCOE student associations', 'https://www.pccoepune.com/student-association.php', 'source_checked'),

-- Professional bodies and student chapters (official association directory)
('acm-pccoe', 'PCCOE ACM Student Chapter', 'acm-pccoe', 'Technical', 'professional_chapter',
 'Professional student chapter linked from PCCOE''s student-association directory. Current activities and membership details are pending administrator review.',
 'ACM|ACM PCCOE', 'PCCOE student associations', 'https://www.pccoepune.com/student-association.php', 'source_checked'),
('acm-w-pccoe', 'PCCOE ACM-W Student Chapter', 'acm-w-pccoe', 'Technical', 'professional_chapter',
 'Professional student chapter linked from PCCOE''s student-association directory. Current activities and membership details are pending administrator review.',
 'ACM-W|ACM W|ACM-W PCCOE', 'PCCOE student associations', 'https://www.pccoepune.com/student-association.php', 'source_checked'),
('csi-pccoe', 'CSI Student Branch', 'csi-pccoe', 'Technical', 'professional_chapter',
 'Professional student chapter linked from PCCOE''s student-association directory. Current activities and membership details are pending administrator review.',
 'CSI|Computer Society of India', 'PCCOE student associations', 'https://www.pccoepune.com/student-association.php', 'source_checked'),
('iet-pccoe', 'IET On Campus PCCOE', 'iet-pccoe', 'Technical', 'professional_chapter',
 'Professional student chapter linked from PCCOE''s student-association directory. Current activities and membership details are pending administrator review.',
 'IET|IET On Campus|Institution of Engineering and Technology', 'PCCOE student associations', 'https://www.pccoepune.com/student-association.php', 'source_checked'),
('iste-pccoe', 'ISTE Student Chapter', 'iste-pccoe', 'Technical', 'professional_chapter',
 'Professional student chapter linked from PCCOE''s student-association directory. Current activities and membership details are pending administrator review.',
 'ISTE|Indian Society for Technical Education', 'PCCOE student associations', 'https://www.pccoepune.com/student-association.php', 'source_checked'),
('codechef-pccoe', 'CodeChef PCCOE Chapter', 'codechef-pccoe', 'Technical', 'professional_chapter',
 'Student chapter linked from PCCOE''s student-association directory. Current activities and membership details are pending administrator review.',
 'CodeChef|CodeChef PCCOE', 'PCCOE student associations', 'https://www.pccoepune.com/student-association.php', 'source_checked'),
('owasp-pccoe', 'OWASP PCCOE Student Chapter', 'owasp-pccoe', 'Technical', 'professional_chapter',
 'PCCOE''s directory lists an Open Web Application Security student chapter. Current activities and membership details are pending administrator review.',
 'OWASP|Open Web Application Security|OWASP PCCOE', 'PCCOE student associations', 'https://www.pccoepune.com/student-association.php', 'source_checked'),
('ieee-pccoe', 'IEEE Student Branch', 'ieee-pccoe', 'Technical', 'professional_chapter',
 'Professional student chapter linked from PCCOE''s student-association directory. Current activities and membership details are pending administrator review.',
 'IEEE|IEEE PCCOE', 'PCCOE student associations', 'https://www.pccoepune.com/student-association.php', 'source_checked'),
('iete-pccoe', 'IETE Students'' Forum', 'iete-pccoe', 'Technical', 'professional_chapter',
 'Professional student chapter linked from PCCOE''s student-association directory. Current activities and membership details are pending administrator review.',
 'IETE|IETE PCCOE', 'PCCOE student associations', 'https://www.pccoepune.com/student-association.php', 'source_checked'),

-- Additional requested organizations; no unsupported public-source claim
('swaad', 'SWAAD', 'swaad', 'Cultural', 'creative_group',
 'Included in the requested Campus+ organization catalogue. A public source, current activities, and contact details are pending verification.',
 '', null, null, 'pending'),
('pac', 'PAC', 'pac', 'Arts', 'creative_group',
 'Included in the requested Campus+ organization catalogue. A public source, current activities, and contact details are pending verification.',
 'Performing Arts Club', null, null, 'pending'),
('nss', 'NSS', 'nss', 'Social', 'service_organization',
 'Included in the requested Campus+ organization catalogue. A public source, current activities, and contact details are pending verification.',
 'National Service Scheme', null, null, 'pending'),
('games-and-sports', 'Games & Sports', 'games-and-sports', 'Sports', 'sports_group',
 'Included in the requested Campus+ organization catalogue. A public source, current activities, and contact details are pending verification.',
 'Games and Sports|Sports Club', null, null, 'pending'),
('samvaad', 'Samvaad', 'samvaad', 'Cultural', 'creative_group',
 'Included in the requested Campus+ organization catalogue. A public source, current activities, and contact details are pending verification.',
 '', null, null, 'pending'),

-- Campus+'s own club. Platform identity is not an external endorsement claim.
('campus-plus', 'Campus+ Club', 'campus-plus', 'Social', 'platform_community',
 'The Campus+ club for directory feedback, product updates, and student community coordination. Membership and activities will be managed here once an administrator is assigned.',
 'Campus+|Campus Plus|Campus Plus Club', 'Campus+ platform directory', null, 'source_checked');

-- Reconcile in one migration transaction. Existing rows are matched by their
-- catalogue key, stable slug, exact name, then a known alias (GDSC/GDG, OWASP).
-- Only provenance fields are enriched; administrator edits remain authoritative.
do $$
declare
  v_seed club_catalogue_seed%rowtype;
  v_id uuid;
begin
  perform set_config('campus.system_context', 'on', true);
  for v_seed in select * from club_catalogue_seed order by catalogue_key loop
    v_id := null;
    select c.id into v_id from public.communities c
     where c.catalogue_key = v_seed.catalogue_key and c.kind = 'club' limit 1;
    if v_id is null then
      select c.id into v_id from public.communities c
       where c.slug = v_seed.slug and c.kind = 'club' limit 1;
    end if;
    if v_id is null then
      select c.id into v_id from public.communities c
       where lower(c.name) = lower(v_seed.name) and c.kind = 'club' limit 1;
    end if;
    if v_id is null and v_seed.aliases <> '' then
      select c.id into v_id from public.communities c
       where c.kind = 'club'
         and lower(c.name) in (select lower(trim(a)) from unnest(string_to_array(v_seed.aliases, '|')) a)
       order by c.created_at, c.id limit 1;
    end if;

    if v_id is null then
      insert into public.communities (
        kind, name, slug, description, club_category, organization_type,
        visibility, join_policy, status, is_official, created_by, approved_by,
        approved_at, member_count, admin_assigned, verification_status,
        source_label, source_url, directory_aliases, catalogue_key
      ) values (
        'club', v_seed.name, v_seed.slug, v_seed.description, v_seed.club_category,
        v_seed.organization_type, 'campus', 'request', 'published', false, null,
        null, null, 0, false, v_seed.verification_status, v_seed.source_label,
        v_seed.source_url, replace(v_seed.aliases, '|', ', '), v_seed.catalogue_key
      );
    else
      update public.communities c set
        catalogue_key = coalesce(c.catalogue_key, v_seed.catalogue_key),
        organization_type = coalesce(c.organization_type, v_seed.organization_type),
        verification_status = case
          when c.verification_status = 'pending' then v_seed.verification_status
          else c.verification_status end,
        source_label = coalesce(c.source_label, v_seed.source_label),
        source_url = coalesce(c.source_url, v_seed.source_url),
        directory_aliases = case when c.directory_aliases = ''
          then replace(v_seed.aliases, '|', ', ') else c.directory_aliases end
       where c.id = v_id;
    end if;
  end loop;
end;
$$;

-- A migration-time assertion prevents accidental extra rows being invented to
-- match the incorrect roster count in the request.
do $$
begin
  if (select count(*) from club_catalogue_seed) <> 35 then
    raise exception 'The reconciled source roster must contain exactly 35 unique entries.';
  end if;
end;
$$;
