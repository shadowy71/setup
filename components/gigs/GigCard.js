import { GigGallery } from '@/components/campus/GigGallery';
import Link from 'next/link';
import { Badge } from '@/components/ui';
import { Icon } from '@/components/ui/icons';
import { formatDate, relativeTime, truncate } from '@/lib/utils';
import { ROUTES, GIG_STATES } from '@/lib/constants';

/**
 * The gig card.
 *
 * A gig is a piece of work, not a listing: the card leads with the work, then
 * the terms (paid/unpaid, rate, deadline) and only then the person offering it.
 * Open / Closed / Completed is the poster's lifecycle; a moderated row says so
 * instead of pretending to be unavailable.
 */

const STATE_TONE = Object.fromEntries(GIG_STATES.map((state) => [state.value, state.tone]));

function deadlineLine(gig) {
  if (!gig.deadline) return null;
  const today = new Date().toISOString().slice(0, 10);
  if (gig.deadline < today) return { text: `Deadline passed · ${formatDate(gig.deadline)}`, late: true };
  if (gig.state !== 'open') return { text: `Deadline ${formatDate(gig.deadline)}`, late: false };
  return { text: `Apply by ${formatDate(gig.deadline)}`, late: false };
}

export function GigCard({ gig, creator = null, className = '' }) {
  const skills = (gig.skills || []).slice(0, 4);
  const extraSkills = (gig.skills || []).length - skills.length;
  const deadline = deadlineLine(gig);
  const moderated = gig.status !== 'published';

  return (
    <article className={`gig-card card group flex flex-col gap-3 p-4 ${className}`}>
      {/* The glyph and the state share the top line so the title gets the full
          card width — three-line titles are what a narrow column produces. */}
      <div className="flex items-center gap-2">
        <span className="gig-card__glyph" aria-hidden="true">
          <Icon name="briefcase" size={17} />
        </span>
        <span className="min-w-0 flex-1 truncate text-2xs uppercase tracking-wide text-muted-soft">{gig.category}</span>
        {moderated ? (
          <Badge tone="danger">{gig.status === 'hidden' ? 'Hidden' : gig.status}</Badge>
        ) : (
          <Badge tone={STATE_TONE[gig.state] || 'neutral'}>{GIG_STATES.find((state) => state.value === gig.state)?.label || gig.state}</Badge>
        )}
      </div>

      <GigGallery postId={gig.id} coverOnly />
      <div className="flex flex-col gap-1">
        <h3 className="t-card leading-snug">
          <Link href={ROUTES.gig(gig.id)} className="line-clamp-2 break-anywhere hover:underline">
            {gig.title}
          </Link>
        </h3>
        {creator ? (
          <p className="truncate text-2xs text-muted-soft">{creator.display_name || creator.username}</p>
        ) : null}
      </div>

      <p className="text-[0.8125rem] leading-relaxed text-muted">{truncate(gig.description, 180)}</p>

      {skills.length ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Required skills">
          {skills.map((skill) => (
            <li key={skill} className="gig-skill">
              {skill}
            </li>
          ))}
          {extraSkills > 0 ? <li className="gig-skill gig-skill--muted">+{extraSkills}</li> : null}
        </ul>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line pt-2.5 text-2xs text-muted">
        {gig.payment_type === 'paid' ? (
          <Badge tone="success" icon="tag">
            {gig.compensation ? `Paid · ${gig.compensation}` : 'Paid'}
          </Badge>
        ) : (
          <Badge tone="neutral">Unpaid</Badge>
        )}
        {deadline ? (
          <span className={deadline.late ? 'text-warning' : undefined}>
            <Icon name="clock" size={12} className="mr-1 inline align-[-2px]" />
            {deadline.text}
          </span>
        ) : null}
        <span className="ml-auto" title={gig.created_at}>
          {relativeTime(gig.created_at)}
        </span>
      </div>
    </article>
  );
}
