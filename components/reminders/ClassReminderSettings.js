'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Card, Notice, Switch } from '@/components/ui';
import { ROUTES } from '@/lib/constants';
import { setClassReminderPreference } from '@/lib/actions/reminders';
import { signalReminders } from '@/lib/reminders/browser';

export function ClassReminderSettings({ initialEnabled = false, division = null, accountType = null, profileId }) {
  const [enabled, setEnabled] = useState(Boolean(initialEnabled));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);

  async function handleToggle(next) {
    setPending(true);
    setError(null);
    setNote(null);
    // Stop immediately, including in other tabs; an unsuccessful save triggers a fresh read.
    if (!next) signalReminders('disabled', profileId);
    try {
      const result = await setClassReminderPreference(next);
      if (!result?.ok) {
        setError(result?.error || 'Could not save your preference. Please try again.');
        signalReminders('changed', profileId);
        return;
      }
      setEnabled(next);
      signalReminders('changed', profileId);
      setNote(next ? 'On. Reminders appear while Campus+ is open in a browser tab.' : 'Off. Class reminder popups are disabled.');
    } catch {
      setError('Could not save your preference. Please try again.');
      signalReminders('changed', profileId);
    } finally { setPending(false); }
  }

  if (accountType !== 'student') {
    return <Card className="flex flex-col gap-2 p-4"><h2 className="text-sm font-semibold">Class reminder popups</h2><p className="text-[0.8125rem] text-muted">Class reminders are available to institutional students with a profile division.</p></Card>;
  }
  return (
    <Card className="flex flex-col gap-2 p-4">
      <h2 className="text-sm font-semibold">Class reminder popups</h2>
      <p className="text-[0.8125rem] text-muted">Show a subtle in-app reminder 10 minutes before your classes while Campus+ is open in a browser tab. Reminders can be delayed when the tab is hidden or the device sleeps and do not work when the app is closed.</p>
      <Switch id="class-reminder-popups" label="Class reminder popups" note={division ? `Division ${division} from your profile` : 'Uses the division in your profile'} checked={enabled} disabled={pending} onChange={(event) => handleToggle(event.target.checked)} />
      {!division ? <Notice tone="warning" icon="clock">Add your division in <Link href={`${ROUTES.settings}?tab=profile`} className="font-medium underline">Settings → Profile</Link> to receive reminders.</Notice> : null}
      {error ? <p className="text-[0.8125rem] text-danger" role="alert">{error}</p> : null}
      {note ? <p className="text-[0.8125rem] text-muted">{note}</p> : null}
    </Card>
  );
}
