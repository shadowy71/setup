import { normalizeBranch } from '@/lib/branches';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { getResource } from '@/lib/data/campus';
import { UUID_REGEX } from '@/lib/constants';
import { PageHeader, Badge, Notice, Card, StaffDot, LinkButton } from '@/components/ui';
import { IdentityLine } from '@/components/identity/IdentityLine';
import { ExternalLink } from '@/components/content/ExternalLink';
import { LinkifiedText } from '@/components/content/LinkifiedText';
import { ReportDialog } from '@/components/social/ReportDialog';
import { formatDate } from '@/lib/utils';

export async function generateMetadata({ params }) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) return { title: 'Resource' };
  const supabase = await getServerClient();
  const resource = await getResource(supabase, id);
  return { title: resource?.title || 'Resource' };
}

/** One resource (spec §34). The link is validated before it is ever stored. */
export default async function ResourcePage({ params }) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) notFound();

  const user = await requireUser();
  const supabase = await getServerClient();
  const actor = toActor(user);
  const resource = await getResource(supabase, id);
  if (!resource) notFound();

  const isStaff = can(actor, 'manage_official_content') || can(actor, 'moderate_all');
  if (resource.status !== 'published' && !isStaff && resource.submitted_by !== user.profile.id) notFound();

  const submitterId = resource.submitted_by || resource.created_by;
  const { data: submitter } = submitterId
    ? await supabase.from('public_profiles').select('id, username, display_name, is_staff').eq('id', submitterId).maybeSingle()
    : { data: null };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={resource.title} back={{ href: '/explore/resources', label: 'Resources' }} />

      <div className="flex flex-wrap items-center gap-2">
        {resource.is_official ? <Badge tone="accent">Official</Badge> : <Badge>Community submitted</Badge>}
        {resource.type ? <Badge>{resource.type}</Badge> : null}
        {resource.branch ? <Badge>{normalizeBranch(resource.branch)}</Badge> : null}
        {resource.semester ? <Badge>{resource.semester}</Badge> : null}
        {resource.status !== 'published' ? <Badge tone="danger">{resource.status}</Badge> : null}
      </div>

      <Card className="flex flex-col gap-3 p-4">
        {resource.description ? (
          <p className="user-text whitespace-pre-wrap text-[0.9375rem] leading-relaxed"><LinkifiedText text={resource.description} /></p>
        ) : null}
        <p className="text-[0.8125rem]">
          <ExternalLink url={resource.url} className="underline">
            Open the resource
          </ExternalLink>
        </p>
        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-muted">
          {resource.subject ? <dd>{resource.subject}</dd> : null}
          {resource.year ? <dd>Year {resource.year}</dd> : null}
          <dd>Published {formatDate(resource.published_at || resource.created_at)}</dd>
        </dl>
      </Card>

      {submitter ? (
        <Card className="flex flex-col gap-2 p-4">
          <h2 className="text-sm font-semibold">Submitted by</h2>
          <IdentityLine
            username={submitter.username}
            displayName={submitter.display_name}
            isStaff={submitter.is_staff}
            badge={submitter.is_staff ? <StaffDot label="Campus+ staff" /> : null}
          />
        </Card>
      ) : null}

      {resource.subject ? (
        <Card className="flex flex-wrap items-center justify-between gap-2 p-4">
          <p className="text-2xs text-muted">More in <strong>{resource.subject}</strong></p>
          <LinkButton href={`/explore/collections/${encodeURIComponent(resource.subject)}`} size="sm" variant="quiet">
            Browse the collection
          </LinkButton>
        </Card>
      ) : null}

      {resource.status !== 'published' ? (
        <Notice tone="warning" icon="clock">
          This resource is {resource.status} and is waiting for staff review.
        </Notice>
      ) : null}

      {can(actor, 'report_content') ? (
        <div className="flex justify-end">
          <ReportDialog targetType="resource" targetRef={resource.id} label="this resource" />
        </div>
      ) : null}
    </div>
  );
}
