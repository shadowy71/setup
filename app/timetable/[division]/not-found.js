import { EmptyState, LinkButton } from '@/components/ui';
import { ROUTES } from '@/lib/constants';

export const metadata = { title: 'Timetable not found' };

/**
 * Invalid division (anything that is not a single letter A–R): a calm 404
 * inside the timetable chrome, with the way back to the selector.
 */
export default function DivisionNotFound() {
  return (
    <main className="mx-auto mt-14 max-w-xl">
      <EmptyState
        icon="calendar"
        title="That division doesn't exist"
        description="First-year divisions run from A to R. Check the letter in the address, or pick your division from the full list."
        action={
          <LinkButton href={ROUTES.timetable} variant="primary" icon="chevronRight">
            All divisions
          </LinkButton>
        }
      />
    </main>
  );
}
