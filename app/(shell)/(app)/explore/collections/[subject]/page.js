import { normalizeBranch } from '@/lib/branches';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { listResources } from '@/lib/data/campus';
import { ROUTES } from '@/lib/constants';
import { PageHeader, EmptyState, Notice } from '@/components/ui';
import { ContentCard } from '@/components/content/ContentCard';

export async function generateMetadata({ params }) {
  const { subject } = await params;
  const name = decodeURIComponent(subject || '');
  return { title: name ? `${name} collection` : 'Collection' };
}

/**
 * A subject collection: every published resource filed under one subject,
 * official and community side by side but never sharing a label.
 */
export default async function CollectionPage({ params }) {
  await requireUser();
  const supabase = await getServerClient();
  const { subject } = await params;
  const name = decodeURIComponent(subject || '').slice(0, 120);

  const { items, unavailable } = name
    ? await listResources(supabase, { limit: 60, subject: name })
    : { items: [], unavailable: false };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={name || 'Collection'}
        description="Every published resource filed under this subject."
        back={{ href: ROUTES.resources, label: 'Resources' }}
      />

      {unavailable ? <Notice tone="warning" icon="flag">This collection could not be loaded right now.</Notice> : null}

      {!unavailable && !items.length ? (
        <EmptyState
          icon="book"
          title="Nothing filed here yet"
          description="Resources tagged with this subject will appear here once published."
        />
      ) : null}

      <section aria-label="Resources in this subject" className="flex flex-col gap-3">
        {items.map((resource) => (
          <ContentCard
            key={resource.id}
            href={ROUTES.resource(resource.id)}
            title={resource.title}
            description={resource.description}
            icon="link"
            official={resource.is_official}
            badges={[
              ...(resource.type ? [{ label: resource.type }] : []),
              ...(resource.branch ? [{ label: normalizeBranch(resource.branch) }] : []),
            ]}
          />
        ))}
      </section>
    </div>
  );
}
