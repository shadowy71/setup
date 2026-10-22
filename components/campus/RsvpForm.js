'use client';

/**
 * Event RSVP (spec §30). Going / Interested / Can't make it — the same row is
 * updated, so an event never accumulates contradictory registrations. The
 * organizer is contacted through the normal DM system, never through a special
 * event channel.
 */

import { Button } from '@/components/ui';
import { useFormAction } from '@/lib/forms';
import { setRsvp } from '@/lib/actions/campus';

const OPTIONS = [
  { value: 'going', label: 'Going' },
  { value: 'interested', label: 'Interested' },
  { value: 'not_going', label: "Can't make it" },
];

export function RsvpForm({ eventId, currentStatus = null, canRsvp = true }) {
  const rsvp = useFormAction(setRsvp, { resetOnSuccess: false });

  if (!canRsvp) {
    return <p className="text-2xs text-muted">RSVP is not available for your account.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {OPTIONS.map((option) => (
          <form
            key={option.value}
            action={(formData) => {
              formData.set('event_id', eventId);
              formData.set('status', option.value);
              rsvp.run(formData);
            }}
          >
            <Button
              type="submit"
              size="sm"
              variant={currentStatus === option.value ? 'warm' : 'secondary'}
              disabled={rsvp.pending}
            >
              {option.label}
            </Button>
          </form>
        ))}
      </div>
      {currentStatus ? (
        <p className="text-2xs text-muted">
          You are marked as <strong>{currentStatus.replace('_', ' ')}</strong>.
        </p>
      ) : (
        <p className="text-2xs text-muted">No RSVP yet.</p>
      )}
      {rsvp.error ? <p className="text-2xs text-danger">{rsvp.error}</p> : null}
      {rsvp.success ? <p className="text-2xs text-success">RSVP saved.</p> : null}
    </div>
  );
}
