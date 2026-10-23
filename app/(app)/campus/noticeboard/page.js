import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { can, toActor } from '@/lib/permissions/authorization';
import { listPublishedNotices } from '@/lib/data/public-cache';
import { ROUTES, PAGE_SIZE } from '@/lib/constants';
import { PageHeader, EmptyState, Notice, LinkButton, Card } from '@/components/ui';
import { ContentCard } from '@/components/content/ContentCard';
import { formatDate } from '@/lib/utils';

export const metadata = { title: 'Noticeboard' };

/**
 * Noticeboard (spec §27). Official only: every row here was published by a role
 * with `manage_notices`. Student discussions never appear on the noticeboard —
 * they live on the feed.
 */
export default async function NoticeboardPage({ searchParams }) {
  const user = await requireUser();
  const actor = toActor(user);
  const params = await searchParams;
  const offset = Math.max(0, Number.parseInt(params?.offset || '0', 10) || 0);
  const category = typeof params?.category === 'string' && params.category ? params.category : null;

  // Published notices are identical for every student, so this read is served
  // from the short public cache (see lib/data/public-cache.js) and revalidated
  // the moment staff publish or edit one.
  const { items, unavailable } = await listPublishedNotices({ limit: PAGE_SIZE.default, offset, category });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Noticeboard"
        description="Official notices from the campus. Published by staff roles only."
        back={{ href: ROUTES.campus, label: 'Campus' }}
        action={can(actor, 'manage_notices') ? <LinkButton href="/moderator?tab=notices" size="sm">Manage notices</LinkButton> : null}
      />

      <Card className="flex flex-wrap gap-1.5 p-3">
        <Link
          href="/campus/noticeboard"
          className="chip"
          data-active={!category}
        >
          Everything
        </Link>
        {['important', 'academic', 'event', 'opportunity', 'general'].map((value) => (
          <Link
            key={value}
            href={`/campus/noticeboard?category=${value}`}
            className="chip"
            data-active={category === value}
          >
            {value}
          </Link>
        ))}
      </Card>

      {unavailable ? (
        <Notice tone="warning" icon="flag">
          Notices could not be loaded right now.
        </Notice>
      ) : null}

      {!unavailable && !items.length ? (
        <EmptyState
          icon="megaphone"
          title={category ? 'No notices in this category' : 'No notices yet'}
          description="When the campus publishes an official notice it appears here."
        />
      ) : null}

      <section aria-label="Notices" className="flex flex-col gap-3">
        {items.map((notice) => (
          <ContentCard
            key={notice.id}
            href={ROUTES.notice(notice.id)}
            title={notice.title}
            description={notice.body}
            icon="megaphone"
            official
            badges={[
              { label: notice.category, tone: notice.importance === 'critical' || notice.importance === 'high' ? 'accent' : 'neutral' },
              ...(notice.pinned ? [{ label: 'Pinned' }] : []),
            ]}
            meta={[`Published ${formatDate(notice.published_at || notice.created_at)}`]}
          />
        ))}
      </section>

      {items.length === PAGE_SIZE.default ? (
        <div className="flex justify-between">
          {offset > 0 ? <LinkButton href={`/campus/noticeboard?offset=${Math.max(0, offset - PAGE_SIZE.default)}`} size="sm" variant="ghost">Newer</LinkButton> : <span />}
          <LinkButton href={`/campus/noticeboard?offset=${offset + PAGE_SIZE.default}`} size="sm" variant="secondary">
            Older notices
          </LinkButton>
        </div>
      ) : null}
    </div>
  );
}
