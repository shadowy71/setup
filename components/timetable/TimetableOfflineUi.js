'use client';

/**
 * The two offline/install surfaces on a division timetable.
 *
 *   - `TimetableOfflinePill` — the compact status in the header row, beside the
 *     clock, where "can I read this without signal?" is answered before a
 *     student scrolls anywhere;
 *   - `TimetableInstallCard` — the one card that saves the batch and offers the
 *     home-screen flow, placed after the timetable so it never covers it;
 *   - `TimetableInstallSheet` — the bottom sheet with browser-specific
 *     instructions, shared by both.
 *
 * All three read the same context (`TimetableOfflineProvider`), so the pill
 * cannot claim "ready" while the card is still saving.
 *
 * Three copy rules this file holds itself to:
 *   - it names the batch the page is showing, using the division letter and the
 *     source's own branch abbreviation;
 *   - it claims only what the platform can prove. `appinstalled` or a
 *     `display-mode` match earns "Added to Home Screen"; a resolved
 *     `prompt()` does not, and on iOS nothing does, because Safari never
 *     reports the shortcut being added;
 *   - the primary button changes label with the state, so the card never grows
 *     a new element next to a stale one.
 */

import { Button, Modal, Notice } from '@/components/ui';
import { Icon } from '@/components/ui/icons';
import { batchName, installLabel } from '@/lib/timetable/batch';
import { offlineStateCopy } from '@/lib/timetable/offline-install';
import { useTimetableOffline } from '@/components/timetable/TimetableOfflineProvider';

function StateDot({ tone }) {
  return <span className={`tt-offline__dot tt-offline__dot--${tone}`} aria-hidden="true" />;
}

/* --------------------------------------------------------------------------
   The state machine's one piece of copy: what the primary button says
   -------------------------------------------------------------------------- */

/**
 * Exported for the tests: the label/disabled pair for a state is the most
 * user-visible contract in the feature, and it must be assertable without a DOM.
 *
 * `install`  → the browser can prompt, and the copy is saved: offer it.
 * `guide`    → no prompt available: open the instructions instead of a dead end.
 * `save`     → nothing stored yet: the offline copy comes first, always.
 */
export function primaryAction({ savedReady, preparing, installOutcome, installPath, error, division }) {
  const addLabel = installLabel(division);

  if (preparing) return { label: 'Preparing offline timetable…', disabled: true, kind: 'busy' };
  if (installOutcome === 'waiting') return { label: 'Waiting for installation confirmation…', disabled: true, kind: 'busy' };
  if (installOutcome === 'accepted') return { label: 'Added to Home Screen', disabled: true, kind: 'done' };
  if (error) return { label: 'Could not prepare offline copy — Retry', disabled: false, kind: 'retry' };
  if (!savedReady) return { label: 'Save timetable for offline use', disabled: false, kind: 'save' };
  if (installPath === 'native') return { label: addLabel, disabled: false, kind: 'install' };
  if (installPath === 'ios') return { label: 'Add to Home Screen from Safari', disabled: false, kind: 'guide' };
  return { label: addLabel, disabled: false, kind: 'guide' };
}

/* --------------------------------------------------------------------------
   Header pill
   -------------------------------------------------------------------------- */

export function TimetableOfflinePill() {
  const {
    hydrated,
    savedReady,
    freshness,
    savedAgo,
    offlineView,
    phase,
    error,
    refreshFailed,
    storage,
    worker,
    openSheet,
  } = useTimetableOffline();

  // A *prepare* failure is an error; a *refresh* failure is not — the saved
  // copy is still valid and is labelled by its age instead.
  const state = !hydrated
    ? 'checking'
    : phase === 'preparing' || phase === 'refreshing'
      ? 'saving'
      : error && !savedReady
        ? 'error'
        : savedReady && (freshness.state === 'stale' || offlineView || refreshFailed)
          ? 'stale'
          : savedReady
            ? 'ready'
            : 'unavailable';

  const copy = offlineStateCopy(state, { savedAgo, freshLabel: freshness.label, error });
  const busy = state === 'saving' || state === 'checking';

  return (
    <div className="tt-offline">
      <button
        type="button"
        className={`tt-offline__pill tt-offline__pill--${copy.tone}`}
        onClick={() => openSheet(savedReady ? 'status' : 'offline')}
        aria-describedby="tt-offline-detail"
      >
        {busy ? <span className="tt-offline__spinner" aria-hidden="true" /> : <StateDot tone={copy.tone} />}
        <span className="tt-offline__label">{copy.label}</span>
      </button>
      {/* A live region, because the whole point of the pill is that its words
          change: "Offline copy ready", then "Saved copy · yesterday". A student
          who cannot see the header should hear the change too. */}
      <p id="tt-offline-detail" className="tt-offline__detail" role="status">
        {copy.detail}
        {storage.backend === 'local-storage' ? ' Stored in this browser’s local storage.' : ''}
        {worker.state === 'dev' ? ' Offline caching is not active in development.' : ''}
        {/* A refused registration (a blocked or private profile) means the *page*
            files may not be kept even though the timetable data definitely is.
            Say so: “saved” would otherwise over-promise an offline reload. */}
        {worker.state === 'error'
          ? ' This browser would not keep the page files, so an offline reload may need a connection.'
          : ''}
      </p>
    </div>
  );
}

/* --------------------------------------------------------------------------
   Install card
   -------------------------------------------------------------------------- */

export function TimetableInstallCard() {
  const {
    batch,
    hydrated,
    saved,
    savedReady,
    savedList,
    freshness,
    savedAgo,
    phase,
    step,
    steps,
    error,
    offlineView,
    needsRefresh,
    install,
    installPath,
    standalone,
    storage,
    worker,
    openSheet,
    prepare,
    installNow,
    refresh,
    removeSaved,
    applyUpdate,
  } = useTimetableOffline();

  const preparing = phase === 'preparing' || phase === 'refreshing';
  const installed = standalone || install.installed;
  const name = batchName(batch?.division);
  const action = primaryAction({
    savedReady,
    preparing,
    installOutcome: install.outcome,
    installPath,
    error,
    division: batch?.division,
  });
  const activeStep = preparing ? steps.findIndex((entry) => entry.key === step) : -1;

  function handleClick() {
    if (action.kind === 'save' || action.kind === 'retry') {
      void prepare();
      return;
    }
    if (action.kind === 'install' || action.kind === 'guide') {
      void installNow();
      return;
    }
    void prepare();
  }

  return (
    <section className="tt-install card" aria-labelledby="tt-install-title" data-state={installed ? 'installed' : 'available'}>
      <div className="tt-install__head">
        <span className="tt-install__mark" aria-hidden="true">
          <Icon name="install" size={20} />
        </span>
        <div className="tt-install__intro">
          <p className="t-label">Offline · Home screen</p>
          <h2 id="tt-install-title" className="t-section mt-1">
            {installed ? `${name} is on your Home Screen` : `Take ${name} with you`}
          </h2>
          <p className="t-secondary mt-1.5 max-w-[62ch]">
            {installed
              ? 'The icon opens straight into this division’s week, and the saved copy refreshes whenever you have a connection.'
              : `Save ${name} on this device, then add it to your Home Screen. It opens directly on ${name} — lectures, batch practicals, rooms and the institute clock — with no signal required.`}
          </p>
        </div>
      </div>

      <ul className="tt-install__points">
        <li>
          <Icon name="wifiOff" size={15} />
          <span>Reads the saved week with no network at all — not a screenshot.</span>
        </li>
        <li>
          <Icon name="clock" size={15} />
          <span>Marks today, NOW and NEXT from the institute clock (Asia/Kolkata).</span>
        </li>
        <li>
          <Icon name="refresh" size={15} />
          <span>A failed refresh keeps your last good copy instead of emptying the page.</span>
        </li>
      </ul>

      {preparing ? (
        <ol className="tt-install__steps" aria-live="polite" aria-label="Offline preparation progress">
          {steps.map((entry, index) => (
            <li key={entry.key} data-state={index < activeStep ? 'done' : index === activeStep ? 'active' : 'todo'}>
              <span className="tt-install__step-mark" aria-hidden="true" />
              {entry.label}
            </li>
          ))}
        </ol>
      ) : null}

      <div className="tt-install__foot">
        <div className="tt-install__status">
          <span className={`tt-chip tt-chip--${savedReady ? (freshness.state === 'stale' ? 'stale' : 'ready') : 'none'}`}>
            <StateDot tone={savedReady ? (freshness.state === 'stale' ? 'stale' : 'ready') : 'muted'} />
            {savedReady ? `Offline copy ready${savedAgo ? ` · saved ${savedAgo}` : ''}` : 'No offline copy yet'}
          </span>
          {saved?.eventCount ? <span className="t-meta">{saved.eventCount} entries stored</span> : null}
          {saved?.bytes ? <span className="t-meta">{Math.max(1, Math.round(saved.bytes / 1024))} kB</span> : null}
          {!hydrated ? <span className="t-meta">Checking this device…</span> : null}
        </div>

        <div className="tt-install__actions">
          <Button
            variant={savedReady ? 'primary' : 'warm'}
            size="lg"
            onClick={handleClick}
            disabled={action.disabled}
            loading={action.kind === 'busy'}
          >
            {action.label}
          </Button>
          <Button variant="quiet" size="md" onClick={() => openSheet(savedReady ? 'status' : 'offline')}>
            {savedReady ? 'Offline copy and install status' : 'Why this needs one online visit'}
          </Button>
        </div>
      </div>

      {install.outcome === 'dismissed' && !installed ? (
        <p className="tt-install__note">
          Installation was dismissed — nothing changed on this device, and the offline copy is still saved. You can add it
          again from here any time.
        </p>
      ) : null}

      {installPath !== 'native' && savedReady && !installed && !error ? (
        <p className="tt-install__note">
          {installPath === 'ios'
            ? 'iPhone adds the shortcut itself, so Campus+ cannot do it for you and will not claim it did. The offline copy is already saved; open the status sheet for the two taps that remain.'
            : 'This browser exposes no install button to pages, so use its own menu. The offline copy is saved either way.'}
        </p>
      ) : null}

      {error ? (
        <Notice tone="danger" icon="alert" className="tt-install__error">
          <p className="font-semibold">The offline copy is not ready.</p>
          <p className="mt-1 t-secondary">{error}</p>
        </Notice>
      ) : null}

      {offlineView && savedReady ? (
        <p className="tt-install__note">
          You are offline. This is the saved copy, last synced {savedAgo || 'earlier'}; schedule changes only arrive when
          the page can reach Campus+.
        </p>
      ) : null}

      {needsRefresh && !offlineView ? (
        <p className="tt-install__note">
          The saved copy predates the last successful read.{' '}
          <button type="button" className="tt-install__link" onClick={() => refresh({ silent: false })}>
            Refresh it now
          </button>
        </p>
      ) : null}

      {worker.updateAvailable ? (
        <p className="tt-install__note">
          A newer version of this page is waiting.{' '}
          <button type="button" className="tt-install__link" onClick={() => applyUpdate()}>
            Update the offline copy
          </button>
        </p>
      ) : null}

      {savedList.length ? (
        <p className="t-meta tt-install__batches">
          {savedList.length === 1 ? '1 batch saved on this device' : `${savedList.length} batches saved on this device`}:
          {' '}
          {savedList.map((entry) => batchName(entry.division)).join(', ')}
          {savedReady ? (
            <>
              {' · '}
              <button type="button" className="tt-install__link" onClick={() => removeSaved()}>
                Remove {name}
              </button>
            </>
          ) : null}
        </p>
      ) : null}

      {savedReady && storage.persisted === false ? (
        <p className="t-meta">
          This browser has not granted durable storage, so it may evict the offline copy when the device runs short.
        </p>
      ) : null}
    </section>
  );
}

/* --------------------------------------------------------------------------
   The sheet: honest instructions, per platform
   -------------------------------------------------------------------------- */

const STEPS = {
  ios: [
    'Open this page in Safari itself — a link inside another app’s in-app browser has no Share sheet.',
    'Tap Share in the toolbar (the box with the arrow pointing up).',
    'Choose Add to Home Screen, then Add.',
    'Keep the suggested name: it is the batch, not the whole of Campus+.',
  ],
  chromium: [
    'Use the install prompt the browser was asked to show, or its menu (⋮) → Install app / Add to Home screen.',
    'Confirm the name and the icon.',
    'The shortcut opens this division’s timetable on its own, without the browser chrome.',
  ],
  firefox: [
    'Open the page menu (≡) and choose “Install to Home screen” or “Shortcut to App” if your build offers it.',
    'Confirm — Firefox saves a shortcut to this exact address.',
    'The shortcut opens this division’s timetable.',
  ],
  safari: [
    'Safari on macOS can add a web app to the Dock: File → Add to Dock (older builds: the share button in the address bar).',
    'Rename it after the batch, then the timetable lives beside your other apps.',
  ],
  other: [
    'Open this browser’s menu and choose Add to Home screen or Create shortcut.',
    'Keep the address — it is what makes the shortcut open this batch rather than Campus+ in general.',
  ],
};

function stepsFor(platform) {
  if (platform.kind === 'ios') return STEPS.ios;
  if (platform.kind === 'android' || platform.kind === 'chromium-desktop') return STEPS.chromium;
  if (platform.kind === 'firefox') return STEPS.firefox;
  if (platform.kind === 'safari-desktop') return STEPS.safari;
  return STEPS.other;
}

export function TimetableInstallSheet() {
  const { sheet, dismissSheet, batch, installPath, platform, savedReady, freshness, savedAgo, install, hasPrompt } =
    useTimetableOffline();
  if (!sheet) return null;

  const name = batchName(batch?.division);
  const kind = sheet === 'offline' || sheet === 'status' ? sheet : 'guide';
  const title =
    kind === 'offline' ? 'Saved for offline use' : kind === 'status' ? 'This timetable on this device' : `Add ${name} to your Home Screen`;

  return (
    <Modal
      open
      onClose={dismissSheet}
      title={title}
      description={
        kind === 'offline'
          ? 'Nothing has to be installed to read a timetable without signal — the saved copy is already on this device.'
          : kind === 'status'
            ? 'Offline readiness and installation are tracked separately, because a saved copy does not prove a shortcut exists.'
            : 'A page cannot press the browser’s own button, so these are the taps that remain.'
      }
      size="sm"
      closeLabel="Close this sheet"
    >
      {kind === 'offline' ? (
        <div className="tt-sheet__block">
          <p className="t-secondary">
            {savedReady
              ? `The whole week for ${name} is stored locally${savedAgo ? `, saved ${savedAgo}` : ''}. Turn off Wi-Fi and mobile data and open the page: it renders from the device, with the day tabs, the free slots and NOW/NEXT still working.`
              : 'The copy is not saved yet. Press “Save timetable for offline use” and the page will work with no signal afterwards.'}
          </p>
          {savedReady && freshness.state !== 'fresh' ? (
            <p className="t-meta mt-2">
              This is a saved copy, not a live one — {freshness.label.toLowerCase()}. Department changes arrive the next
              time the page reaches Campus+.
            </p>
          ) : null}
        </div>
      ) : kind === 'status' ? (
        <dl className="tt-sheet__facts">
          <div>
            <dt>Batch</dt>
            <dd>{name}</dd>
          </div>
          <div>
            <dt>Offline copy</dt>
            <dd>{savedReady ? `Ready · ${savedAgo || 'just saved'}` : 'Not saved'}</dd>
          </div>
          <div>
            <dt>Added to Home Screen</dt>
            <dd>{install.installed ? 'Confirmed by the browser' : 'No confirmation received from this browser'}</dd>
          </div>
          <div>
            <dt>Install path</dt>
            <dd>{installPath === 'native' ? 'Browser prompt available' : `Manual — ${platform.label}`}</dd>
          </div>
        </dl>
      ) : (
        <div className="tt-sheet__block">
          <ol className="tt-sheet__steps">
            {stepsFor(platform).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
          <p className="t-meta mt-3">
            {platform.kind === 'ios'
              ? 'iOS never tells the page that a shortcut was added, so Campus+ will not say it was.'
              : hasPrompt
                ? 'The browser asks for confirmation; this card only says “added” once that comes back accepted.'
                : 'No install event is available here, so nothing is claimed until you close this sheet.'}
          </p>
          <p className="t-meta mt-2">
            The shortcut opens {name} directly, inside the timetable scope, and renders from the saved copy when there is no
            signal.
          </p>
        </div>
      )}

      <div className="dialog-actions">
        <Button variant="primary" onClick={dismissSheet}>
          Done
        </Button>
      </div>
    </Modal>
  );
}
