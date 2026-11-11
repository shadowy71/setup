'use client';

/**
 * Administrative controls (spec §51, §54, §55).
 *
 * Every control forwards to a server action that calls a SECURITY DEFINER
 * function (`grant_role`, `revoke_role`, `admin_set_account_status`,
 * `admin_set_platform_setting`) or a permission-checked table policy. The
 * component only decides what to render; the database decides what is allowed,
 * and every accepted change lands in the audit log.
 */

import { useState } from 'react';
import { Button, Field, Input, Notice, Select, Switch, Textarea } from '@/components/ui';
import { useFormAction } from '@/lib/forms';
import { grantRole, revokeRole, setAccountStatus, setPlatformSetting, setFeatureFlag, setUploadPermission } from '@/lib/actions/admin';
import { ACCOUNT_STATUS } from '@/lib/constants';

const ACCOUNT_STATUS_LABELS = {
  active: 'Active',
  suspended: 'Suspended',
  banned: 'Banned',
  deactivated: 'Deactivated',
  deleted: 'Deleted',
  pending: 'Pending',
};

/** Grant a role to a user (never `student` — that is the default). */
export function GrantRoleForm({ userId, roles = [], currentRoles = [] }) {
  const grant = useFormAction(grantRole, { resetOnSuccess: true });
  const available = roles.filter((role) => role.key !== 'student' && !currentRoles.includes(role.key));

  if (!available.length) {
    return <p className="text-2xs text-muted">No staff role can be granted to this account.</p>;
  }

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      action={(formData) => {
        formData.set('user_id', userId);
        grant.run(formData);
      }}
    >
      <Select name="role" defaultValue={available[0].key} aria-label="Role to grant" className="w-auto">
        {available.map((role) => (
          <option key={role.key} value={role.key}>
            {role.label}
          </option>
        ))}
      </Select>
      <Button type="submit" size="sm" variant="secondary" disabled={grant.pending}>
        {grant.pending ? 'Granting…' : 'Grant role'}
      </Button>
      {grant.error ? <Notice tone="danger">{grant.error}</Notice> : null}
      {grant.success ? <Notice tone="success">Role granted.</Notice> : null}
    </form>
  );
}

/** Revoke one staff role from a user. */
export function RevokeRoleForm({ userId, role, label }) {
  const revoke = useFormAction(revokeRole, { resetOnSuccess: false });
  return (
    <form
      className="inline"
      action={(formData) => {
        formData.set('user_id', userId);
        formData.set('role', role);
        revoke.run(formData);
      }}
    >
      <Button type="submit" size="sm" variant="danger" icon="close" disabled={revoke.pending} aria-label={`Revoke ${label || role}`}>
        {revoke.pending ? 'Revoking…' : `Revoke ${label || role}`}
      </Button>
      {revoke.error ? <Notice tone="danger">{revoke.error}</Notice> : null}
    </form>
  );
}

/** Change an account status, with an audit-visible reason. */
export function AccountStatusForm({ userId, currentStatus = 'active' }) {
  const [open, setOpen] = useState(false);
  const status = useFormAction(setAccountStatus, { resetOnSuccess: true });

  if (!open) {
    return (
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Change account status
      </Button>
    );
  }

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      action={(formData) => {
        formData.set('user_id', userId);
        status.run(formData);
      }}
    >
      <Select name="status" defaultValue={currentStatus === 'unknown' ? 'active' : currentStatus} aria-label="Account status" className="w-auto">
        {ACCOUNT_STATUS.map((value) => (
          <option key={value} value={value}>
            {ACCOUNT_STATUS_LABELS[value] || value}
          </option>
        ))}
      </Select>
      <Input
        name="duration_days"
        type="number"
        min={0}
        max={3650}
        placeholder="Days (suspension)"
        className="w-[8.5rem]"
        aria-label="Duration in days"
      />
      <Input name="reason" maxLength={500} placeholder="Reason (recorded in the audit log)" className="min-w-[12rem] flex-1" aria-label="Reason" />
      <Button type="submit" size="sm" disabled={status.pending}>
        {status.pending ? 'Saving…' : 'Save status'}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      {status.error ? <Notice tone="danger">{status.error}</Notice> : null}
      {status.success ? <Notice tone="success">Account status updated.</Notice> : null}
    </form>
  );
}

/** Edit one platform setting. Values are JSON so numbers/booleans stay typed. */
export function PlatformSettingForm({ settingKey, value, description = null }) {
  const [open, setOpen] = useState(false);
  const save = useFormAction(setPlatformSetting, { resetOnSuccess: false });
  const initial = typeof value === 'string' ? value : JSON.stringify(value);

  if (!open) {
    return (
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-2xs text-muted">{settingKey}</p>
          {description ? <p className="text-2xs text-muted">{description}</p> : null}
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}>
          Edit
        </Button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-2"
      action={(formData) => {
        formData.set('key', settingKey);
        save.run(formData);
      }}
    >
      <Field
        label={settingKey}
        htmlFor={`setting-${settingKey}`}
        hint="JSON — use true/false for switches, a number for limits, or quoted text."
      >
        <Textarea id={`setting-${settingKey}`} name="value" rows={2} defaultValue={initial} maxLength={2000} />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={save.pending}>
          {save.pending ? 'Saving…' : 'Save setting'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Close
        </Button>
        {save.error ? <Notice tone="danger">{save.error}</Notice> : null}
        {save.success ? <Notice tone="success">Setting saved.</Notice> : null}
      </div>
    </form>
  );
}

/** Toggle one feature flag. */
export function FeatureFlagToggle({ flagKey, enabled }) {
  const [on, setOn] = useState(Boolean(enabled));
  const save = useFormAction(setFeatureFlag, { resetOnSuccess: false });

  return (
    <form
      className="flex flex-wrap items-center gap-3"
      action={(formData) => {
        formData.set('key', flagKey);
        formData.set('enabled', on ? 'true' : 'false');
        save.run(formData);
      }}
    >
      <Switch
        id={`flag-${flagKey}`}
        checked={on}
        onChange={(event) => setOn(event.target.checked)}
        label={on ? 'Enabled' : 'Disabled'}
        note="Applies to every student immediately."
      />
      <Button type="submit" size="sm" variant="secondary" disabled={save.pending}>
        {save.pending ? 'Saving…' : 'Apply'}
      </Button>
      {save.error ? <Notice tone="danger">{save.error}</Notice> : null}
      {save.success ? <Notice tone="success">Flag updated.</Notice> : null}
    </form>
  );
}

/** Changes permission only; student uploads remain unavailable until the feature is complete. */
export function UploadPermissionForm({ userId, enabled }) {
  const change = useFormAction(setUploadPermission, { resetOnSuccess: false });
  return (
    <form action={(data) => { data.set('user_id', userId); data.set('enabled', String(!enabled)); change.run(data); }}>
      <Button type="submit" size="sm" variant="ghost" disabled={change.pending}>
        {change.pending ? 'Saving…' : enabled ? 'Revoke upload access' : 'Grant upload access'}
      </Button>
      {change.error ? <Notice tone="danger">{change.error}</Notice> : null}
      {change.success ? <Notice tone="success">Upload permission updated.</Notice> : null}
    </form>
  );
}
