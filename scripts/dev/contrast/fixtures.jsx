/* Browser-only audit fixture. Bundled by audit.mjs and mounted in its isolated
 * Playwright page; this is NOT a Next route or a production/auth bypass. */
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Button, DeleteButton, KeycapButton, IconButton, SheenButton,
} from '@/components/ui/buttons';
import { Field, Input, Textarea, Select, Checkbox, Switch } from '@/components/ui/fields';
import { Card, GlassSurface, Badge, IdentityMark, Notice, PageHeader } from '@/components/ui/surfaces';
import { TiltCard, WheelSelector } from '@/components/ui/interactive';
import { EmptyState, ErrorState, WordLoader, OrbLoader, CascadeLoader, LoadingPanel } from '@/components/ui/states';
import { Modal, Dropdown, MenuItem, MenuLink, Toast } from '@/components/ui/overlays';
import { SearchField } from '@/components/ui/SearchField';
import { Icon } from '@/components/ui/icons';

function SampleCopy() {
  return (
    <div className="flex flex-col gap-1">
      <p className="t-card">Campus+ reading surface</p>
      <p className="text-sm text-ink-soft">Secondary copy and a meaningful icon <Icon name="book" size={14} /></p>
      <p className="text-2xs text-muted">Muted content must remain readable.</p>
      <p className="text-2xs text-muted-soft">Metadata is content, not decoration.</p>
    </div>
  );
}

function Section({ title, children, id }) {
  return (
    <section id={id} className="card flex flex-col gap-4 p-5" data-audit-section={id}>
      <h2 className="t-section">{title}</h2>
      {children}
    </section>
  );
}

function Fixture() {
  const [modal, setModal] = useState(false);
  const [toast, setToast] = useState(null);
  return (
    <main id="cp-contrast-fixture" className="mx-auto flex max-w-3xl flex-col gap-5 p-5">
      <PageHeader title="Campus+ contrast regression fixtures" description="Local test content only. Real presentation components; no actions, network writes or production route." />
      <Section id="buttons" title="Buttons — resting, hover, focused, pressed, disabled">
        <div className="flex flex-wrap gap-3">
          <Button data-audit="primary" icon="send">Primary action</Button>
          <Button data-audit="accent" tone="accent" icon="plus">Accent action</Button>
          <Button data-audit="warm" variant="warm" icon="send">Warm action</Button>
          <SheenButton data-audit="sheen" icon="search">Explore campus</SheenButton>
          {['secondary', 'quiet', 'subtle', 'danger'].map((variant) => (
            <Button key={variant} variant={variant} data-audit={variant} icon="check">{variant} action</Button>
          ))}
          <DeleteButton data-audit="delete">Delete item</DeleteButton>
          <KeycapButton data-audit="keycap">Confirm</KeycapButton>
          <KeycapButton data-audit="keycap-accent" tone="accent">Save</KeycapButton>
          <IconButton data-audit="icon-button" label="More actions" icon="more" />
          <Button data-audit="disabled-link" as="a" href="#buttons" disabled>Disabled link</Button>
          <Button data-audit="loading" loading>Saving changes</Button>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button disabled>Disabled primary</Button>
          <SheenButton disabled>Disabled Explore</SheenButton>
          <DeleteButton disabled>Disabled delete</DeleteButton>
          <KeycapButton disabled>Disabled key</KeycapButton>
          <IconButton label="Unavailable action" icon="close" disabled />
        </div>
      </Section>
      <Section id="fields" title="Fields and placeholders">
        <Field label="Display name" htmlFor="audit-name" hint="A clearly readable hint" required>
          <Input id="audit-name" placeholder="Enter a display name" data-audit="input" />
        </Field>
        <Field label="Biography" htmlFor="audit-bio" error="Explain the problem in readable text, not color alone">
          <Textarea id="audit-bio" placeholder="Write a little about yourself" invalid data-audit="textarea" />
        </Field>
        <Select aria-label="Branch" data-audit="select"><option>Computer Engineering</option><option>Mechanical Engineering</option></Select>
        <Input disabled placeholder="Disabled field placeholder" />
        <Input disabled defaultValue="Disabled but readable value" />
        <Textarea disabled placeholder="Disabled textarea placeholder" rows={2} />
        <Select disabled aria-label="Disabled selection"><option>Unavailable selection</option></Select>
        <SearchField hint="A search hint on a paired surface" />
      </Section>
      <Section id="checks" title="Checkboxes and tactile switches">
        <Checkbox id="audit-check" label="Receive in-app notifications" note="Unchecked choices stay visible" data-audit="checkbox" />
        <Checkbox id="audit-checked" defaultChecked label="Selected choice" note="The checkmark has its own foreground/background pair" />
        <Checkbox id="audit-check-disabled" disabled label="Unavailable choice" note="Disabled labels are not translucent" />
        <Checkbox id="audit-checked-disabled" disabled defaultChecked label="Unavailable selected choice" />
        <Switch id="audit-switch" label="Show branch and year" note="Tactile thumb stays distinct" data-audit="switch" />
        <Switch id="audit-switch-checked" defaultChecked label="Selected switch" />
        <Switch id="audit-switch-disabled" disabled label="Unavailable switch" />
        <Switch id="audit-switch-disabled-checked" disabled defaultChecked label="Unavailable selected switch" />
      </Section>
      <Section id="chips" title="Badges, pills, avatars and selected states">
        <div className="flex flex-wrap gap-2">
          {['neutral', 'accent', 'success', 'warning', 'danger', 'info', 'live'].map((tone) => <Badge key={tone} tone={tone} icon="checkCircle">{tone} label</Badge>)}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="chip chip-toggle" data-audit="chip">Like this</button>
          <button type="button" className="chip chip-toggle" aria-pressed="true">Selected chip</button>
          <button type="button" className="chip chip-toggle" disabled>Unavailable chip</button>
          <button type="button" className="chip chip-toggle" disabled aria-pressed="true">Selected unavailable chip</button>
          <span className="chip chip-static">Read-only technology</span>
        </div>
        <div className="segmented">
          <button type="button" className="chip chip-plain" aria-selected="true">Selected tab</button>
          <button type="button" className="chip chip-plain">Unselected tab</button>
        </div>
        <div className="flex items-center gap-3">
          <IdentityMark name="Student" /><IdentityMark name="Student" tone="accent" />
          <span className="text-sm text-ink">Student name <span className="text-2xs text-muted">@student</span></span>
        </div>
      </Section>
      <Section id="surfaces" title="Cards, feature gradients and tilt glare">
        {['', 'card-flush', 'card-feature', 'card-elevated'].map((variant) => <Card key={variant} className={`${variant} p-4`}><SampleCopy /></Card>)}
        <TiltCard cardClassName="card card-feature p-4"><SampleCopy /><Button className="mt-3">Featured card action</Button></TiltCard>
      </Section>
      <Section id="glass" title="Glass over worst-case contrasting backdrops">
        {['soft', 'floating', 'strong', 'featured', 'premium', 'cinematic', 'read'].map((tone) => (
          <div key={tone} className="p-3" style={{ background: 'linear-gradient(110deg, var(--cp-brand-plate), var(--cp-sky-bg))', borderRadius: 'var(--radius-lg)' }}>
            <GlassSurface tone={tone} className="glass-sheen p-4"><SampleCopy /></GlassSurface>
          </div>
        ))}
      </Section>
      <Section id="feedback" title="Notices, loading, empty and error states">
        {['neutral', 'accent', 'success', 'warning', 'danger', 'info'].map((tone) => <Notice key={tone} tone={tone} icon="alert">{tone} feedback with primary content and <span className="text-2xs text-muted">readable secondary detail</span></Notice>)}
        <div className="flex flex-wrap items-center gap-4"><WordLoader /><OrbLoader size="lg" /><CascadeLoader /></div>
        <LoadingPanel rows={1} />
        <EmptyState title="Nothing here yet" description="An honest, readable empty state" action={<Button>Start a discussion</Button>} />
        <ErrorState title="Unable to load this surface" description="A useful explanation that remains readable" action={<Button variant="secondary">Try again</Button>} />
      </Section>
      <Section id="contextual" title="Chat, poll results, Lost & found">
        <div className="cp-chat-bubble rounded-lg border p-3"><p className="user-text">A received message with readable content.</p><p className="text-2xs text-muted">Message metadata · Sent</p></div>
        <div className="cp-chat-bubble cp-chat-bubble--mine rounded-lg border p-3"><p className="user-text">A sent message with readable content.</p><p className="text-2xs text-muted">Message metadata · Seen</p></div>
        <button type="button" disabled className="cp-poll-option cp-poll-option--selected rounded-lg border p-3" aria-pressed="true">
          <span className="flex justify-between"><span>Your poll choice ✓</span><span className="text-2xs text-muted">64%</span></span>
          <span className="cp-poll-track mt-2 block h-1.5 rounded-full"><span className="cp-poll-fill cp-poll-fill--selected block h-full w-2/3 rounded-full" /></span>
        </button>
        <div className="lf-banner lf-banner--lost"><span className="lf-banner__kicker">Lost item</span><p className="lf-banner__line">A clear description of what was lost.</p></div>
        <div className="lf-banner lf-banner--found"><span className="lf-banner__kicker">Found item</span><p className="lf-banner__line">A clear description of what was found.</p></div>
      </Section>
      <Section id="overlays" title="Menus, modal, toast and native tooltips">
        <Dropdown label="Audit menu" trigger={<Icon name="more" size={16} />}>
          <MenuItem icon="book">Readable menu action</MenuItem>
          <MenuItem icon="lock" disabled>Unavailable menu action</MenuItem>
          <MenuLink href="#overlays" icon="users">Community link</MenuLink>
        </Dropdown>
        <Button data-audit="open-modal" onClick={() => setModal(true)}>Open dialog</Button>
        <div className="flex flex-wrap gap-2">
          {['neutral', 'success', 'danger'].map((tone) => <Button key={tone} variant="secondary" data-audit={`toast-${tone}`} onClick={() => setToast(tone)}>Show {tone} toast</Button>)}
          <Button variant="quiet" data-audit="clear-toast" onClick={() => setToast(null)}>Clear toast</Button>
        </div>
        <IconButton label="Native tooltip and accessible label" icon="info" />
      </Section>
      <Section id="wheel" title="Readable rotating wheel options">
        <WheelSelector name="audit-wheel" defaultValue="feed" options={[
          { value: 'feed', label: 'Feed', note: 'Latest posts first' },
          { value: 'discussions', label: 'Discussions', note: 'Questions and answers' },
          { value: 'polls', label: 'Polls', note: 'Quick campus votes' },
        ]} />
        <WheelSelector name="audit-wheel-disabled" disabled defaultValue="feed" legend="Unavailable selector" options={[
          { value: 'feed', label: 'Feed', note: 'Latest posts first' },
          { value: 'discussions', label: 'Discussions', note: 'Questions and answers' },
          { value: 'polls', label: 'Polls', note: 'Quick campus votes' },
        ]} />
        <WheelSelector name="audit-wheel-many" legend="A larger option set" options={
          ['One', 'Two', 'Three', 'Four', 'Five'].map((label) => ({ value: label, label, note: 'Every choice stays visible' }))
        } />
      </Section>
      <Modal open={modal} onClose={() => setModal(false)} title="Readable dialog" description="Muted content stays visible on a strongly backed floating surface" footer={<><Button variant="secondary" onClick={() => setModal(false)}>Cancel</Button><DeleteButton onClick={() => setModal(false)}>Remove item</DeleteButton></>}>
        <div className="mt-4 flex flex-col gap-3"><SampleCopy /><Input placeholder="Dialog placeholder" aria-label="Dialog input" /><Notice tone="warning" icon="alert">Explain consequences, not just color.</Notice></div>
      </Modal>
      <Toast tone={toast || 'neutral'} icon="check">{toast ? `${toast} confirmation that remains readable on the night canvas` : null}</Toast>
    </main>
  );
}

createRoot(document.getElementById('cp-contrast-root')).render(<Fixture />);
