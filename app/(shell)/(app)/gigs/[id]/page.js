import { GigGallery } from '@/components/campus/GigGallery';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { getGig, getGigApplication, listGigApplications } from '@/lib/data/marketplace';
import { ROUTES, UUID_REGEX, GIG_STATES, GIG_STATE_LABELS } from '@/lib/constants';
import { PageHeader, Badge, Notice, Card, StaffDot, SectionHeader } from '@/components/ui';
import { Icon } from '@/components/ui/icons';
import { IdentityLine } from '@/components/identity/IdentityLine';
import { MessageButton } from '@/components/social/MessageButton';
import { ReportDialog } from '@/components/social/ReportDialog';
import { LinkifiedText } from '@/components/content/LinkifiedText';
import { GigActions, GigApplications } from '@/components/gigs/GigActions';
import { formatDate } from '@/lib/utils';

export async function generateMetadata({ params }) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) return { title: 'Gig' };
  const supabase = await getServerClient();
  const gig = await getGig(supabase, id);
  return { title: gig?.title || 'Gig' };
}

/**
 * A gig's own page (spec §19).
 *
 * Everything a student needs to decide is on one screen: the work, the terms,
 * who is offering it and how to apply. Applications live in one table with RLS,
 * so the poster sees who applied and nobody else does. Contact continues in the
 * normal DM system — a gig is work, not a second marketplace.
 */
export default async function GigPage({ params }) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) notFound();

  const user = await requireUser();
  const supabase = await getServerClient();
  const actor = toActor(user);
  const gig = await getGig(supabase, id);
  if (!gig) notFound();

  const isCreator = gig.creator_id === user.profile.id;
  const canModerate = can(actor, 'moderate_marketplace') || can(actor, 'moderate_all');
  if (!['published', 'hidden', 'removed'].includes(gig.status) && !isCreator && !canModerate) notFound();

  const [creatorResult, myApplication, applications] = await Promise.all([
    supabase
      .from('public_profiles')
      .select('id, username, display_name, is_staff, marketplace_completed_count')
      .eq('id', gig.creator_id)
      .maybeSingle(),
    getGigApplication(supabase, gig.id, user.profile.id),
    isCreator ? listGigApplications(supabase, gig.id) : Promise.resolve([]),
  ]);
  const creator = creatorResult.data;

  const stateMeta = GIG_STATES.find((entry) => entry.value === gig.state) || GIG_STATES[0];
  const today = new Date().toISOString().slice(0, 10);
  const deadlinePassed = Boolean(gig.deadline && gig.deadline < today);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={gig.title}
        eyebrow={`Gig · ${gig.category}`}
        description={`Posted ${formatDate(gig.created_at)} · ${GIG_STATE_LABELS[gig.state] || gig.state}`}
        back={{ href: ROUTES.gigs, label: 'Gigs' }}
        action={
          canModerate && !isCreator ? <ReportDialog targetType="gig" targetRef={gig.id} label="this gig" /> : null
        }
      />

      {gig.status !== 'published' ? (
        <Notice tone="warning" icon="flag">
          This gig is {gig.status}. Only you and moderators can see it.
        </Notice>
      ) : null}

      <GigGallery postId={id} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3 p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={gig.status === 'published' ? stateMeta.tone : 'danger'} icon={gig.state === 'open' ? 'checkCircle' : 'clock'}>
                {gig.status === 'published' ? stateMeta.label : gig.status}
              </Badge>
              {gig.payment_type === 'paid' ? (
                <Badge tone="success" icon="tag">
                  {gig.compensation ? `Paid · ${gig.compensation}` : 'Paid'}
                </Badge>
              ) : (
                <Badge>Unpaid</Badge>
              )}
              {deadlinePassed && gig.state === 'open' ? <Badge tone="warning">Deadline passed</Badge> : null}
            </div>

            <p className="user-text text-[0.9375rem] leading-relaxed">
              <LinkifiedText text={gig.description} mentions />
            </p>

            {gig.skills?.length ? (
              <div className="flex flex-col gap-1.5">
                <h2 className="text-2xs font-semibold uppercase tracking-wide text-muted">Skills wanted</h2>
                <ul className="flex flex-wrap gap-1.5">
                  {gig.skills.map((skill) => (
                    <li key={skill} className="gig-skill">
                      {skill}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <dl className="grid gap-2 border-t border-line pt-3 text-[0.8125rem] sm:grid-cols-2">
              <div className="flex items-start gap-2">
                <Icon name="clock" size={14} className="mt-0.5 shrink-0 text-muted" />
                <div>
                  <dt className="text-2xs uppercase tracking-wide text-muted-soft">Deadline</dt>
                  <dd>{gig.deadline ? formatDate(gig.deadline) : 'No deadline'}</dd>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Icon name="calendar" size={14} className="mt-0.5 shrink-0 text-muted" />
                <div>
                  <dt className="text-2xs uppercase tracking-wide text-muted-soft">Availability</dt>
                  <dd>{gig.availability || 'Not specified'}</dd>
                </div>
              </div>
            </dl>

            {gig.contact_details ? (
              <div className="rounded-[var(--radius-md)] border border-line bg-surface-2/60 p-3">
                <h2 className="text-2xs font-semibold uppercase tracking-wide text-muted">What to include in your application</h2>
                <p className="user-text mt-1 text-[0.8125rem] leading-relaxed">
                  <LinkifiedText text={gig.contact_details} />
                </p>
              </div>
            ) : null}

            <GigActions gig={gig} creatorId={user.profile.id} canApply myApplication={myApplication} />
          </Card>

          {isCreator ? (
            <Card className="flex flex-col gap-3 p-4">
              <SectionHeader
                title="Applications"
                description="Everyone who applied, with their message. Accept or decline — they are notified either way."
                icon="inbox"
              />
              {gig.state !== 'open' ? (
                <Notice tone="neutral" icon="info">
                  This gig is {GIG_STATE_LABELS[gig.state]?.toLowerCase()}. New applications are closed; existing
                  ones can still be decided.
                </Notice>
              ) : null}
              <GigApplications applications={applications} gigId={gig.id} />
            </Card>
          ) : null}
        </div>

        <aside className="flex flex-col gap-3">
          <Card className="flex flex-col gap-3 p-4">
            <h2 className="text-sm font-semibold">Who is offering this</h2>
            {creator ? (
              <IdentityLine
                username={creator.username}
                displayName={creator.display_name}
                isStaff={creator.is_staff}
                badge={creator.is_staff ? <StaffDot label="Campus+ staff" /> : null}
              />
            ) : (
              <p className="text-[0.8125rem] text-muted">Student profile unavailable.</p>
            )}
            {creator?.marketplace_completed_count ? (
              <p className="text-2xs text-muted">
                {creator.marketplace_completed_count} completed marketplace exchange
                {creator.marketplace_completed_count === 1 ? '' : 's'}
              </p>
            ) : null}
            {!isCreator ? (
              <div className="flex flex-col gap-2">
                <MessageButton profileId={gig.creator_id} label="Message about this gig" />
                <a href="#apply" className="text-center text-2xs text-muted underline hover:text-ink">
                  Jump to the application
                </a>
              </div>
            ) : (
              <p className="text-2xs text-muted">You posted this gig. Applications arrive on the left.</p>
            )}
          </Card>

          <Card className="flex flex-col gap-2 p-4">
            <h2 className="text-sm font-semibold">Keeping it safe</h2>
            <p className="text-2xs leading-relaxed text-muted">
              Agree the details in Messages and meet on campus. Campus+ never processes payments, and nobody should
              ask you to pay in advance.
            </p>
            <p className="text-2xs leading-relaxed text-muted">
              Something wrong? Use the report control in the header — moderators review gigs.
            </p>
          </Card>
        </aside>
      </div>
    </div>
  );
}
