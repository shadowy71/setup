'use client';

import { useState } from 'react';
import { useFormAction } from '@/lib/forms';
import { completeOnboarding } from '@/lib/actions/auth';
import { BRANCHES, YEARS, DIVISIONS, LIMITS } from '@/lib/constants';
import { Button, Checkbox, Field, Input, Notice, Select, Textarea } from '@/components/ui';
import { normalizeUsername } from '@/lib/utils';

/**
 * Onboarding form. Username availability is checked against the public
 * projection as you type (a hint only); `complete_profile()` is the authority
 * and returns the real conflict if the name was taken meanwhile.
 */
export function OnboardingForm() {
  // The first visit ends on the guide, not on a feed the student has not been
  // told anything about yet. It is a real route with a real "Open Home" button at
  // the end, so the flow still lands on Home one tap later; `useFormAction`
  // refreshes the session, so the guide renders its post-sign-up state.
  const { run, pending, error, fieldErrors } = useFormAction(completeOnboarding, { redirectTo: '/guide?welcome=1' });
  const [username, setUsername] = useState('');
  const [accepted, setAccepted] = useState(false);

  return (
    <form
      action={run}
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        run(new FormData(event.currentTarget));
      }}
    >
      <Field
        label="Username"
        htmlFor="username"
        required
        error={fieldErrors?.username}
        hint={`Lowercase letters, numbers, underscores · ${LIMITS.username.min}–${LIMITS.username.max} characters`}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted">@</span>
          <Input
            id="username"
            name="username"
            value={username}
            onChange={(event) => setUsername(normalizeUsername(event.target.value))}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck="false"
            required
            aria-invalid={fieldErrors?.username ? 'true' : undefined}
          />
        </div>
      </Field>

      <Field label="Display name" htmlFor="display_name" required error={fieldErrors?.display_name}>
        <Input id="display_name" name="display_name" maxLength={LIMITS.displayName.max} required autoComplete="name" />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Branch" htmlFor="branch" error={fieldErrors?.branch}>
          <Select id="branch" name="branch" defaultValue="">
            <option value="">Prefer not to say</option>
            {BRANCHES.map((branch) => (
              <option key={branch} value={branch}>
                {branch}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Year" htmlFor="year" error={fieldErrors?.year}>
          <Select id="year" name="year" defaultValue="">
            <option value="">Prefer not to say</option>
            {YEARS.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Division" htmlFor="division" error={fieldErrors?.division} hint="Optional.">
        <Select id="division" name="division" defaultValue="">
          <option value="">Not specified</option>
          {DIVISIONS.map((division) => (
            <option key={division} value={division}>
              {division}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Bio" htmlFor="bio" error={fieldErrors?.bio} hint={`Optional · ${LIMITS.bio.max} characters`}>
        <Textarea id="bio" name="bio" rows={3} maxLength={LIMITS.bio.max} placeholder="What are you into?" />
      </Field>

      <Checkbox
        id="show_branch_year"
        name="show_branch_year"
        value="true"
        defaultChecked
        label="Show my branch and year on my profile"
      />

      <Checkbox
        id="accept_rules"
        name="accept_rules"
        value="true"
        checked={accepted}
        onChange={(event) => setAccepted(event.target.checked)}
        label="I agree to keep Campus+ respectful: no harassment, no spam, no impersonation."
      />

      {error ? (
        <Notice tone="danger" icon="flag">
          {error}
        </Notice>
      ) : null}

      <Button type="submit" disabled={pending || !accepted} className="w-full">
        {pending ? 'Creating your profile…' : 'Create profile and continue'}
      </Button>
    </form>
  );
}
