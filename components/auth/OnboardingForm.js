'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useFormAction } from '@/lib/forms';
import { completeOnboarding } from '@/lib/actions/auth';
import { BRANCHES, YEARS, DIVISIONS, LIMITS } from '@/lib/constants';
import { onboardingSchema, visitorOnboardingSchema, validate } from '@/lib/validation/schemas';
import { normalizeUsername } from '@/lib/utils';
import { GhostScene } from '@/components/atmosphere/GhostScene';
import { BrandLockup } from '@/components/brand/Brand';
import { IndependenceNotice } from '@/components/brand/IndependenceNotice';
import { ThemeToggle } from '@/components/layout/ThemeToggle';

const INITIAL = { display_name: '', username: '', branch: '', year: '', division: '', bio: '', show_branch_year: true, accept_rules: false };
const SAMPLE = { ...INITIAL, display_name: 'Asha Patil', username: 'asha_p', branch: 'Computer Engineering', year: 'Second Year', division: 'O', bio: 'Always curious and up for a good campus conversation.' };
/**
 * The institutional questions. A visitor's step list is STEPS minus these —
 * see `stepsFor()` below. Keeping them in one list with an `institutionalOnly`
 * flag means the ordering, progress bar and validation stay identical for both
 * account types without a second, drifting copy of the flow.
 */
const STEPS = [
  // A visitor's identity line is written for the public sphere, not for
  // classmates: an external account is not a student and does not have any.
  { field: 'display_name', eyebrow: 'A little introduction', title: 'What should we call you?', copy: 'Your display name is how you’ll appear to other people on Campus+.' },
  { field: 'username', eyebrow: 'Make it yours', title: 'Pick your @username.', copy: 'This is how students can find and mention you. You can change it later, subject to a cooldown.' },
  { field: 'branch', eyebrow: 'Your campus', title: 'Which branch are you in?', copy: 'Share your branch if you’d like. You can always add it later.', optional: true, institutionalOnly: true },
  { field: 'year', eyebrow: 'Your campus', title: 'What year are you in?', copy: 'This helps classmates know where you are in your journey.', optional: true, institutionalOnly: true },
  { field: 'division', eyebrow: 'Your campus', title: 'Do you have a division?', copy: 'Choose one to make your timetable shortcut more useful.', optional: true, institutionalOnly: true },
  { field: 'bio', eyebrow: 'A little about you', title: 'Anything you’d like to share?', copy: 'A short bio is a nice way to introduce yourself. This is completely optional.', optional: true },
  { field: 'show_branch_year', eyebrow: 'Your profile, your choice', title: 'Show your academic details?', copy: 'Choose whether your branch and year are visible on your profile.', institutionalOnly: true },
  { field: 'accept_rules', eyebrow: 'One last thing', title: 'Let’s keep this a good place.', copy: 'Campus+ works best when everyone feels welcome and respected.' },
];

/** The steps an account type actually walks through. */
function stepsFor(isVisitor) {
  return isVisitor ? STEPS.filter((step) => !step.institutionalOnly) : STEPS;
}

function fieldError(field, values, isVisitor = false) {
  const result = validate(values, isVisitor ? visitorOnboardingSchema : onboardingSchema);
  return result.errors?.[field] || '';
}

export function OnboardingForm({ storageId = 'preview', preview = false, accountType = null }) {
  // An external account never sees the institutional questions. `preview` is the
  // sample flow, which deliberately shows the full student experience.
  const isVisitor = !preview && accountType === 'visitor';
  const steps = stepsFor(isVisitor);
  // The storage key is account-type scoped: a browser that once held a student
  // draft must not prefill a visitor's flow (or vice versa).
  const storageKey = `campus:onboarding:v1:${preview ? 'preview' : `${storageId}:${isVisitor ? 'visitor' : 'student'}`}`;
  const [values, setValues] = useState(() => preview ? SAMPLE : INITIAL);
  const [step, setStep] = useState(0);
  const [ready, setReady] = useState(false);
  const [localError, setLocalError] = useState('');
  const [finished, setFinished] = useState(false);
  const { run, pending, error, fieldErrors } = useFormAction(completeOnboarding, {
    redirectTo: '/home',
    onSuccess: () => { try { localStorage.removeItem(storageKey); } catch {} },
  });

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (saved?.values && typeof saved.values === 'object') {
        const restored = { ...INITIAL };
        for (const key of Object.keys(INITIAL)) {
          if (typeof saved.values[key] === typeof INITIAL[key]) restored[key] = saved.values[key];
        }
        let index = Math.min(steps.length - 1, Math.max(0, Number.isInteger(saved.step) ? saved.step : 0));
        for (let i = 0; i < index; i += 1) if (fieldError(steps[i].field, restored)) { index = i; break; }
        // Synchronize this account-scoped browser draft after hydration.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setValues(restored);
        setStep(index);
      }
    } catch { /* Storage is an enhancement, not a requirement. */ }
    setReady(true);
  }, [storageKey, steps]);

  useEffect(() => {
    if (!ready || finished) return;
    try { localStorage.setItem(storageKey, JSON.stringify({ values, step })); } catch {}
  }, [ready, finished, storageKey, values, step]);

  useEffect(() => {
    if (!fieldErrors) return;
    const index = steps.findIndex(({ field }) => fieldErrors[field]);
    // Surface server validation at its corresponding question.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (index >= 0) { setStep(index); setLocalError(fieldErrors[steps[index].field]); }
  }, [fieldErrors, steps]);

  const current = steps[step];
  const update = (field, value) => { setValues((previous) => ({ ...previous, [field]: value })); setLocalError(''); };
  const move = (index) => { setLocalError(''); setStep(index); };
  const next = () => {
    const problem = fieldError(current.field, values, isVisitor);
    if (problem) { setLocalError(problem); return; }
    if (step < steps.length - 1) { move(step + 1); return; }
    // Visitors are validated against the shorter contract; the server action
    // validates the same way before calling complete_profile().
    const all = validate(values, isVisitor ? visitorOnboardingSchema : onboardingSchema);
    if (!all.ok) { const index = steps.findIndex(({ field }) => all.errors?.[field]); if (index >= 0) { setStep(index); setLocalError(all.errors[steps[index].field]); } return; }
    if (preview) { setFinished(true); try { localStorage.removeItem(storageKey); } catch {} return; }
    const formData = new FormData();
    for (const [key, value] of Object.entries(values)) formData.set(key, String(value));
    run(formData);
  };
  const options = current.field === 'branch' ? BRANCHES : current.field === 'year' ? YEARS : current.field === 'division' ? DIVISIONS : null;

  return (
    <main className="login-stage cinematic-stage onboarding-stage">
      <GhostScene className="onboarding-ghost" placement="onboarding" />
      <div className="login-vignette" aria-hidden="true" />
      <div className="onboarding-wrap">
        <header className="onboarding-header">
          <BrandLockup href="/" size="lg" wordClass="text-[1.3125rem]" />
          <ThemeToggle />
        </header>
        {preview && <nav className="onboarding-demo-nav" aria-label="Preview each question">
          <span>EXPLORE THE DEMO</span>
          <div>{STEPS.map((item, index) => <button key={item.field} type="button" aria-current={!finished && step === index ? 'step' : undefined} onClick={() => { setFinished(false); move(index); }}>{['Name', 'Username', 'Branch', 'Year', 'Division', 'Bio', 'Privacy', 'Rules'][index]}</button>)}</div>
        </nav>}
        <section className="onboarding-content" aria-label="Profile setup">
          <div className="onboarding-topline"><span>{preview ? 'SAMPLE DEMO · NO ACCOUNT NEEDED' : 'YOUR CAMPUS+ PROFILE'}</span><span>{finished ? 'ALL DONE' : `STEP ${step + 1} / ${steps.length}`}</span></div>
          <div className="onboarding-progress" role="progressbar" aria-label="Profile setup progress" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={finished ? steps.length : step + 1}>
            {steps.map((item, i) => <span key={item.field} className={i <= step || finished ? 'is-active' : ''} />)}
          </div>
          {finished ? <div className="onboarding-question"><p className="onboarding-eyebrow">THAT’S A WRAP</p><h1>You’re ready to find your place.</h1><p className="onboarding-copy">This is a preview—nothing was saved to an account.</p><button className="onboarding-button onboarding-primary" type="button" onClick={() => { setValues(SAMPLE); setStep(0); setFinished(false); }}>Try it again <span aria-hidden="true">↗</span></button></div> : (
            <form onSubmit={(event) => { event.preventDefault(); next(); }} noValidate>
              <div className="onboarding-question" key={current.field}>
                <p className="onboarding-eyebrow">{current.eyebrow}</p>
                <h1 id="onboarding-question" aria-live="polite">{current.title}</h1>
                <p className="onboarding-copy" id="onboarding-description">{current.copy}</p>
                <div className="onboarding-control">
                  {current.field === 'display_name' || current.field === 'username' ? (
                    <div className="onboarding-input-wrap">{current.field === 'username' && <span aria-hidden="true">@</span>}<input id={current.field} name={current.field} aria-labelledby="onboarding-question" aria-describedby="onboarding-description onboarding-hint" aria-invalid={Boolean(localError)} value={values[current.field]} maxLength={current.field === 'username' ? LIMITS.username.max : LIMITS.displayName.max} autoComplete={current.field === 'display_name' ? 'name' : 'off'} autoCapitalize={current.field === 'username' ? 'none' : 'words'} spellCheck={false} placeholder={current.field === 'display_name' ? 'Your name' : 'your_username'} onChange={(event) => update(current.field, current.field === 'username' ? normalizeUsername(event.target.value) : event.target.value)} /></div>
                  ) : null}
                  {current.field === 'username' && <p className="onboarding-hint" id="onboarding-hint">3–24 characters · lowercase letters, numbers and underscores</p>}
                  {current.field === 'display_name' && <p className="onboarding-hint" id="onboarding-hint">This name will be visible on your profile.</p>}
                  {options && <fieldset className={`onboarding-options ${current.field === 'division' ? 'onboarding-options--division' : ''}`} aria-labelledby="onboarding-question" aria-describedby="onboarding-description"><legend className="sr-only">{current.title}</legend>{options.map((option) => <label className={`onboarding-option ${values[current.field] === option ? 'is-selected' : ''}`} key={option}><input type="radio" name={current.field} value={option} checked={values[current.field] === option} onChange={() => update(current.field, option)} /><span>{option}</span><i aria-hidden="true" /></label>)}</fieldset>}
                  {current.field === 'bio' && <><textarea aria-labelledby="onboarding-question" aria-describedby="onboarding-description" value={values.bio} maxLength={LIMITS.bio.max} rows={4} placeholder="A few words about you…" onChange={(event) => update('bio', event.target.value)} /><p className="onboarding-hint">{values.bio.length} / {LIMITS.bio.max} characters</p></>}
                  {current.field === 'show_branch_year' && <fieldset className="onboarding-options" aria-labelledby="onboarding-question"><legend className="sr-only">Profile visibility</legend>{[[true, 'Show on my profile', 'Let other students see my branch and year.'], [false, 'Keep them private', 'I can change this later in Settings.']].map(([value, label, detail]) => <label key={label} className={`onboarding-option onboarding-option--detail ${values.show_branch_year === value ? 'is-selected' : ''}`}><input type="radio" name="visibility" checked={values.show_branch_year === value} onChange={() => update('show_branch_year', value)} /><span><strong>{label}</strong><small>{detail}</small></span><i aria-hidden="true" /></label>)}</fieldset>}
                  {current.field === 'accept_rules' && <label className={`onboarding-agreement ${values.accept_rules ? 'is-selected' : ''}`}><input type="checkbox" checked={values.accept_rules} onChange={(event) => update('accept_rules', event.target.checked)} /><span>I agree to keep Campus+ respectful: no harassment, no spam, no impersonation.</span></label>}
                  {current.field === 'accept_rules' && <p className="onboarding-hint">Read the <Link href="/rules" target="_blank">community rules ↗</Link></p>}
                  {localError && <p className="onboarding-error" role="alert">{localError}</p>}
                  {error && !localError && <p className="onboarding-error" role="alert">{error}</p>}
                </div>
              </div>
              <div className="onboarding-actions">
                <button type="button" className="onboarding-button onboarding-back" disabled={step === 0 || pending || !ready} onClick={() => move(step - 1)}>← <span>Back</span></button>
                <div className="onboarding-forward">{current.optional && <button type="button" className="onboarding-skip" disabled={pending || !ready} onClick={() => { update(current.field, ''); move(step + 1); }}>Skip for now</button>}<button type="submit" className="onboarding-button onboarding-primary" disabled={pending || !ready}>{pending ? 'Saving…' : step === steps.length - 1 ? 'Create profile' : 'Continue'} <span aria-hidden="true">→</span></button></div>
              </div>
            </form>
          )}
          <p className="onboarding-privacy">YOUR EMAIL STAYS PRIVATE <span>✦</span> YOU CAN EDIT YOUR PROFILE LATER</p>
        </section>
        <IndependenceNotice className="onboarding-disclaimer" />
      </div>
    </main>
  );
}
