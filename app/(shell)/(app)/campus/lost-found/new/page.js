import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { can, toActor } from '@/lib/permissions/authorization';
import { PageHeader, Notice } from '@/components/ui';
import { ActionForm } from '@/components/forms/ActionForm';
import { createLostFound } from '@/lib/actions/campus';
import { ROUTES } from '@/lib/constants';

export const metadata = { title: 'Report an item' };

/**
 * Report a lost or found item (spec §31). Text only — describe it clearly.
 *
 * The flow starts with an explicit, unmistakable choice — "What are you
 * reporting?" — because the whole feature lives or dies on never mixing the
 * two directions up. Only after [LOST ITEM] or [FOUND ITEM] is picked does
 * the form appear, headed by the chosen kind, and that kind is what the
 * post carries (`lost_found.kind`, unchanged) and what every card, detail
 * and filter shows.
 */
export default async function NewLostFoundPage({ searchParams }) {
  const user = await requireUser();
  const actor = toActor(user);
  const params = await searchParams;
  const rawKind = typeof params?.kind === 'string' ? params.kind : null;
  const kind = rawKind === 'found' ? 'found' : rawKind === 'lost' ? 'lost' : null;

  if (!can(actor, 'create_lost_found')) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Report an item" back={{ href: ROUTES.lostFound, label: 'Lost & found' }} />
        <Notice tone="warning" icon="lock">
          Your account cannot create lost &amp; found posts right now.
        </Notice>
      </div>
    );
  }

  // Step 1 — the explicit choice. No defaults, no ambiguity.
  if (!kind) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title="What are you reporting?"
          description="Pick the kind of report first. It sets the form, the labels and how your post appears to everyone."
          back={{ href: ROUTES.lostFound, label: 'Lost & found' }}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Link
            href={`${ROUTES.lostFoundNew}?kind=lost`}
            className="lf-choice lf-choice--lost group flex flex-col gap-2 rounded-[var(--radius-lg)] border p-5 transition-transform duration-200 hover:-translate-y-0.5"
          >
            <span className="lf-choice__badge" data-kind="lost">
              Lost item
            </span>
            <h2 className="text-base font-semibold text-ink">I lost something</h2>
            <p className="text-[0.8125rem] text-muted">
              Report an item you have lost on campus so anyone who finds it can recognise it and reach you.
            </p>
            <span className="mt-1 inline-flex items-center gap-1 text-2xs font-semibold text-accent">
              Report a lost item
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </span>
          </Link>
          <Link
            href={`${ROUTES.lostFoundNew}?kind=found`}
            className="lf-choice lf-choice--found group flex flex-col gap-2 rounded-[var(--radius-lg)] border p-5 transition-transform duration-200 hover:-translate-y-0.5"
          >
            <span className="lf-choice__badge" data-kind="found">
              Found item
            </span>
            <h2 className="text-base font-semibold text-ink">I found something</h2>
            <p className="text-[0.8125rem] text-muted">
              Report an item you have found that is not yours, so the owner can claim it by describing it first.
            </p>
            <span className="mt-1 inline-flex items-center gap-1 text-2xs font-semibold text-accent">
              Report a found item
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </span>
          </Link>
        </div>
        <Notice tone="neutral" icon="shield">
          Claiming an item? Ask a question only the owner could answer rather than describing it first.
        </Notice>
      </div>
    );
  }

  // Step 2 — the form for the chosen kind, headed by it.
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={kind === 'found' ? 'Report a found item' : 'Report a lost item'}
        description="Describe the item and where and when it was seen."
        back={{ href: ROUTES.lostFound, label: 'Lost & found' }}
      />
      <div className="flex items-center gap-2">
        <span className="lf-choice__badge" data-kind={kind}>
          {kind === 'found' ? 'Found item' : 'Lost item'}
        </span>
        <Link href={ROUTES.lostFoundNew} className="text-2xs text-muted underline">
          Reporting the other kind?
        </Link>
      </div>
      <ActionForm
        action={createLostFound}
        lostFoundImages={user.profile.username}
        hidden={{ kind }}
        submitLabel="Post report"
        successMessage="Posted. Anyone who recognises the item can message you."
        cancelHref={ROUTES.lostFound}
        resetOnSuccess={false}
        redirectTo={ROUTES.lostFound}
        fields={[
          {
            name: 'title',
            label: kind === 'found' ? 'What did you find?' : 'What did you lose?',
            required: true,
            maxLength: 140,
            placeholder: kind === 'found' ? 'Black Casio calculator, found near the library' : 'Black Casio calculator',
          },
          {
            name: 'description',
            label: 'Details',
            type: 'textarea',
            required: true,
            maxLength: 1000,
            hint: 'Do not include personal contact details — people can message you here.',
          },
          { name: 'location', label: 'Where', maxLength: 120, placeholder: 'Block C, second floor' },
          {
            name: 'occurred_on',
            label: kind === 'found' ? 'When did you find it?' : 'When did you lose it?',
            type: 'date',
          },
        ]}
      />
      <Notice tone="neutral" icon="shield">
        Claiming an item? Ask a question only the owner could answer rather than describing it first.
      </Notice>
    </div>
  );
}
