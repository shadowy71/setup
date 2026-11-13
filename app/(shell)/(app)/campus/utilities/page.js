import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { listUtility, UTILITY_KEYS } from '@/lib/data/campus';
import { ROUTES } from '@/lib/constants';
import { PageHeader, EmptyState, Notice, Card, Badge } from '@/components/ui';
import { ExternalLink } from '@/components/content/ExternalLink';
import { LinkifiedText } from '@/components/content/LinkifiedText';
import { formatDate } from '@/lib/utils';

export const metadata = { title: 'Campus utilities' };

const SECTIONS = {
  locations: { label: 'Locations', description: 'Where things are on campus — blocks, labs, offices.' },
  services: { label: 'Services', description: 'Who to approach and where they sit.' },
  cafeteria: { label: 'Cafeteria', description: 'Menus, timings and offers.' },
  transport: { label: 'Transport', description: 'Routes, timings and pickup points.' },
  calendar: { label: 'Academic calendar', description: 'Semester dates, exams and holidays.' },
  links: { label: 'Forms & links', description: 'Official forms and portals, opened externally.' },
  help: { label: 'Help hub', description: 'Who to contact when something goes wrong.' },
};

// `academic_calendar.entry_type` (supabase/migrations/009_campus.sql). Fixed DB
// enum — must never leak its snake_case spelling (e.g. "semester_start") to users.
const ENTRY_TYPE_LABELS = {
  exam: 'Exam',
  semester_start: 'Semester start',
  semester_end: 'Semester end',
  holiday: 'Holiday',
  deadline: 'Deadline',
  academic_event: 'Academic event',
  other: 'Other',
};

// `help_contacts.category` (same migration). Same reasoning — "anti_ragging"
// must render as "Anti-ragging", not with a raw underscore.
const HELP_CATEGORY_LABELS = {
  emergency: 'Emergency',
  medical: 'Medical',
  security: 'Security',
  counselling: 'Counselling',
  anti_ragging: 'Anti-ragging',
  other: 'Other',
};

/**
 * Campus utilities (spec §43–§46).
 *
 * Everything here is text. There is no map SDK and no embedded content: each
 * location carries a description and, when the campus provides one, an external
 * map link that opens in a new tab.
 */
export default async function UtilitiesPage({ searchParams }) {
  await requireUser();
  const supabase = await getServerClient();
  const params = await searchParams;
  const section = UTILITY_KEYS.includes(String(params?.section)) ? String(params.section) : 'locations';

  const { items, unavailable } = await listUtility(supabase, section, { limit: 80 });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Campus utilities"
        description="Directory, services, cafeteria, transport, calendar, forms and help — all text."
        back={{ href: ROUTES.campus, label: 'Campus' }}
      />

      <Card className="flex flex-wrap gap-1.5 p-3">
        {UTILITY_KEYS.map((key) => (
          <a
            key={key}
            href={`/campus/utilities?section=${key}`}
            className="chip"
            data-active={section === key}
          >
            {SECTIONS[key].label}
          </a>
        ))}
      </Card>

      <p className="text-2xs text-muted">{SECTIONS[section].description}</p>

      {unavailable ? (
        <Notice tone="warning" icon="flag">
          This section could not be loaded right now.
        </Notice>
      ) : null}

      {!unavailable && !items.length ? (
        <EmptyState
          icon="book"
          title={`No ${SECTIONS[section].label.toLowerCase()} published`}
          description="Campus staff publish this information. Nothing is invented when it is missing."
        />
      ) : null}

      <section aria-label={SECTIONS[section].label} className="flex flex-col gap-3">
        {items.map((item) => (
          <Card key={item.id} className="flex flex-col gap-2 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[0.9375rem] font-medium">{item.name || item.title || item.route_name}</h2>
              {item.category ? <Badge>{HELP_CATEGORY_LABELS[item.category] || item.category}</Badge> : null}
              {item.entry_type ? <Badge tone="accent">{ENTRY_TYPE_LABELS[item.entry_type] || item.entry_type}</Badge> : null}
              {item.audience ? <Badge>{item.audience}</Badge> : null}
              {item.service_status ? <Badge>{item.service_status}</Badge> : null}
            </div>
            {item.description ? <p className="user-text text-[0.8125rem] leading-relaxed text-muted"><LinkifiedText text={item.description} /></p> : null}
            {item.menu_text ? <p className="user-text whitespace-pre-wrap text-[0.8125rem] leading-relaxed text-muted"><LinkifiedText text={item.menu_text} /></p> : null}
            {item.offers ? <p className="user-text text-[0.8125rem] text-muted">Offers: <LinkifiedText text={item.offers} /></p> : null}
            <dl className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-muted">
              {item.block ? <dd>{item.block}</dd> : null}
              {item.location ? <dd>{item.location}</dd> : null}
              {item.hours ? <dd>{item.hours}</dd> : null}
              {item.timings ? <dd>{item.timings}</dd> : null}
              {item.pickup_locations ? <dd>Pickup: {item.pickup_locations}</dd> : null}
              {item.contact_info ? <dd><LinkifiedText text={item.contact_info} /></dd> : null}
              {item.availability ? <dd>{item.availability}</dd> : null}
              {item.purpose ? <dd>{item.purpose}</dd> : null}
              {item.starts_on ? <dd>{formatDate(item.starts_on)}{item.ends_on ? ` – ${formatDate(item.ends_on)}` : ''}</dd> : null}
              {item.deadline ? <dd>Deadline {formatDate(item.deadline)}</dd> : null}
            </dl>
            {item.external_map_url || item.external_url || item.url ? (
              <p className="text-[0.8125rem]">
                <ExternalLink url={item.external_map_url || item.external_url || item.url} className="underline">
                  {item.external_map_url ? 'Open in maps' : 'Open link'}
                </ExternalLink>
              </p>
            ) : null}
          </Card>
        ))}
      </section>

      <p className="pb-2 text-center text-2xs text-muted">
        Text-only by design: Campus+ does not embed third-party maps or documents.
      </p>
    </div>
  );
}
