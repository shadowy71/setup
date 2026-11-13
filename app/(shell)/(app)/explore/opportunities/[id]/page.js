import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { getOpportunity } from '@/lib/data/campus';
import { OPPORTUNITY_CATEGORIES, UUID_REGEX } from '@/lib/constants';
import { PageHeader, Badge, Card, Notice } from '@/components/ui';
import { ExternalLink } from '@/components/content/ExternalLink';
import { LinkifiedText } from '@/components/content/LinkifiedText';
import { ReportDialog } from '@/components/social/ReportDialog';
import { formatDate } from '@/lib/utils';

export async function generateMetadata({ params }) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) return { title: 'Opportunity' };
  const supabase = await getServerClient();
  const opportunity = await getOpportunity(supabase, id);
  return { title: opportunity?.title || 'Opportunity' };
}

/** One opportunity (spec §35). Community submissions are never disguised as official. */
export default async function OpportunityPage({ params }) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) notFound();

  const user = await requireUser();
  const supabase = await getServerClient();
  const actor = toActor(user);
  const opportunity = await getOpportunity(supabase, id);
  if (!opportunity) notFound();

  const isStaff = can(actor, 'manage_official_content') || can(actor, 'moderate_all');
  if (opportunity.status !== 'published' && !isStaff && opportunity.created_by !== user.profile.id) notFound();

  const expired = opportunity.deadline && new Date(opportunity.deadline) < new Date();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={opportunity.title} back={{ href: '/explore/opportunities', label: 'Opportunities' }} />

      <div className="flex flex-wrap items-center gap-2">
        {opportunity.source === 'official' ? <Badge tone="accent">Official</Badge> : <Badge>Community submitted</Badge>}
        {opportunity.category ? <Badge>{OPPORTUNITY_CATEGORIES.find((c) => c.value === opportunity.category)?.label || opportunity.category}</Badge> : null}
        {opportunity.mode ? <Badge>{opportunity.mode}</Badge> : null}
        {expired ? <Badge tone="danger">Deadline passed</Badge> : null}
        {opportunity.status !== 'published' ? <Badge tone="danger">{opportunity.status}</Badge> : null}
      </div>

      <Card className="flex flex-col gap-3 p-4">
        {opportunity.description ? (
          <p className="user-text whitespace-pre-wrap text-[0.9375rem] leading-relaxed"><LinkifiedText text={opportunity.description} /></p>
        ) : null}
        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-muted">
          {opportunity.organization ? <dd>{opportunity.organization}</dd> : null}
          {opportunity.location ? <dd>{opportunity.location}</dd> : null}
          {opportunity.deadline ? <dd>Apply by {formatDate(opportunity.deadline)}</dd> : null}
        </dl>
        {opportunity.eligibility ? <p className="text-[0.8125rem] text-muted">Eligibility: {opportunity.eligibility}</p> : null}
        <p className="text-[0.8125rem]">
          <ExternalLink url={opportunity.url} className="underline">
            Open the original posting
          </ExternalLink>
        </p>
      </Card>

      {opportunity.source !== 'official' ? (
        <Notice tone="warning" icon="flag">
          This entry was submitted by a student, not by the campus. Verify it before you apply, and never
          pay a fee to apply.
        </Notice>
      ) : null}

      {can(actor, 'report_content') ? (
        <div className="flex justify-end">
          <ReportDialog targetType="opportunity" targetRef={opportunity.id} label="this opportunity" />
        </div>
      ) : null}
    </div>
  );
}
