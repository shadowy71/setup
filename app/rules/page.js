import Link from 'next/link';
import { Icon } from '@/components/ui/icons';
import { LinkButton } from '@/components/ui';
import { PublicShell } from '@/components/layout/PublicShell';

export const metadata = { title: 'Community rules' };

/**
 * The community rules page. Deliberately short, concrete and human — these are
 * the same reasons the report dialog offers, and the platform is moderated by
 * people (spec §17: no automated moderation).
 */
export default function RulesPage() {
  const rules = [
    ['Keep it respectful', 'No harassment, bullying, hate speech, threats or targeted pile-ons.'],
    ['No spam or advertising', 'Promotions belong in the marketplace, clearly priced and honest.'],
    ['Be honest', 'No impersonation, no fake listings, no scams, no academic dishonesty.'],
    ['Respect privacy', 'Do not share someone else\u2019s personal information, screenshots of DMs or Random identities.'],
    ['Moderation stays moderation', 'Do not repost content that moderators removed.'],
    ['Text stays text', 'Campus+ is text-first by design. No file or image uploads.'],
  ];

  return (
    <PublicShell
      eyebrow="Campus+"
      title="Community rules"
      description="Campus+ is run by students for students. Reports are reviewed by people, and every moderation action is logged."
      width="lg"
    >
      <ol className="card divide-y divide-line overflow-hidden">
        {rules.map(([title, body], index) => (
          <li key={title} className="flex gap-3.5 p-4">
            <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-line bg-surface-2 text-2xs font-bold text-muted">
              {index + 1}
            </span>
            <div className="min-w-0">
              <p className="t-card">{title}</p>
              <p className="t-caption mt-1 leading-relaxed">{body}</p>
            </div>
          </li>
        ))}
      </ol>

      <p className="mt-6 flex items-start gap-2.5 text-[0.8125rem] text-muted">
        <Icon name="shield" size={16} className="mt-0.5 shrink-0" />
        Anything that breaks these rules can be reported from where you see it. Reporting is always
        available, even if you have blocked the person.
      </p>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <LinkButton href="/login" variant="primary" icon="chevronRight">
          Back to sign-in
        </LinkButton>
        <Link href="/guide" className="text-[0.8125rem] font-medium text-muted underline hover:text-ink">
          What is Campus+?
        </Link>
      </div>
    </PublicShell>
  );
}
