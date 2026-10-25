/**
 * Real Postgres restore target for `scripts/backup/restore.mjs`.
 *
 * It restores ONLY the tables named in the snapshot manifest (schema `public`).
 * Capture/updated_at triggers are disabled for the restore transaction so that
 * replaying changes does not generate a second outbox history, and every row is
 * upserted by primary key so replay is idempotent.
 *
 * This never touches `auth.*`, `storage.*`, roles, grants or secrets. The caller
 * must provision those separately; `restoreFromBackup()` prints that warning.
 */

import pg from 'pg';

import { createState, rowKey, stateTable } from './restore.js';

const SAFE_NAME = /^[a-z_][a-z0-9_]*$/;
const quoteIdent = (name) => {
  if (!SAFE_NAME.test(name)) throw new Error(`unsafe identifier in snapshot manifest: ${name}`);
  return `"${name}"`;
};

/** Convert a JSON snapshot value into something node-postgres can bind. */
export function serialiseSnapshotValue(value, dataType) {
  if (value === null || value === undefined) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return dataType === 'ARRAY' ? value : JSON.stringify(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

export class PgTarget {
  constructor({ connectionString, logger = null } = {}) {
    if (!connectionString) throw new Error('a restore target connection string is required');
    this.connectionString = connectionString;
    this.logger = logger;
    this.client = null;
    this.manifestTables = [];
    this.disabledTriggers = false;
    this.usedReplicaRole = false;
  }

  async begin() {
    this.client = new pg.Client({ connectionString: this.connectionString, connectionTimeoutMillis: 15000 });
    await this.client.connect();
    await this.client.query('begin');
    try {
      await this.client.query('set session_replication_role = replica');
      this.usedReplicaRole = true;
    } catch {
      // Supabase's postgres role is not a superuser on every plan. Fall back to
      // disabling user triggers on precisely the tables we are restoring.
      this.usedReplicaRole = false;
    }
  }

  async disableTriggersOnce() {
    if (this.usedReplicaRole || this.disabledTriggers) return;
    for (const entry of this.manifestTables) {
      await this.client.query(`alter table public.${quoteIdent(entry.name)} disable trigger user`);
    }
    this.disabledTriggers = true;
  }

  async insertRows(entry, rows) {
    const columns = (entry.columns || []).filter((column) => SAFE_NAME.test(column));
    if (!columns.length || !rows.length) return;
    const pk = (entry.key_columns || []).filter((column) => columns.includes(column));
    if (!pk.length) throw new Error(`table ${entry.name} has no primary key columns in its manifest`);
    const updateColumns = columns.filter((column) => !pk.includes(column));
    const conflict = updateColumns.length
      ? `on conflict (${pk.map(quoteIdent).join(', ')}) do update set ${updateColumns.map((column) => `${quoteIdent(column)} = excluded.${quoteIdent(column)}`).join(', ')}`
      : `on conflict (${pk.map(quoteIdent).join(', ')}) do nothing`;

    const chunkSize = 100;
    for (let offset = 0; offset < rows.length; offset += chunkSize) {
      const chunk = rows.slice(offset, offset + chunkSize);
      const values = [];
      const placeholders = chunk.map((row, rowIndex) => {
        const start = rowIndex * columns.length;
        const slots = columns.map((column, columnIndex) => `$${start + columnIndex + 1}`);
        for (const column of columns) values.push(serialiseSnapshotValue(row?.[column], entry.column_types?.[column]));
        return `(${slots.join(', ')})`;
      });
      await this.client.query(
        `insert into public.${quoteIdent(entry.name)} (${columns.map(quoteIdent).join(', ')}) values ${placeholders.join(', ')} ${conflict}`,
        values,
      );
    }
  }

  async replaceTables(tables, manifestTables) {
    this.manifestTables = manifestTables || [];
    await this.disableTriggersOnce();
    const names = this.manifestTables.map((entry) => `public.${quoteIdent(entry.name)}`);
    if (!names.length) throw new Error('snapshot manifest has no tables to restore');
    await this.client.query(`truncate table ${names.join(', ')} restart identity cascade`);
    for (const entry of this.manifestTables) {
      await this.insertRows(entry, tables[entry.name] || []);
    }
  }

  async applyChanges(changes) {
    const byName = new Map(this.manifestTables.map((entry) => [entry.name, entry]));
    for (const change of changes) {
      const entry = byName.get(change.table_name);
      if (!entry) throw new Error(`snapshot does not include table ${change.table_name} referenced by an incremental event`);
      if (change.operation === 'delete') {
        const keys = Object.keys(change.row_pk || {});
        if (!keys.length) throw new Error(`delete event ${change.id} has no primary key`);
        await this.client.query(
          `delete from public.${quoteIdent(entry.name)} where ${keys.map((key, index) => `${quoteIdent(key)} = $${index + 1}`).join(' and ')}`,
          keys.map((key) => serialiseSnapshotValue(change.row_pk[key], entry.column_types?.[key])),
        );
        continue;
      }
      await this.insertRows(entry, [change.row_data || {}]);
    }
  }

  async snapshotState() {
    const state = createState();
    for (const entry of this.manifestTables) {
      const table = stateTable(state, entry.name);
      const columns = (entry.columns || []).filter((column) => SAFE_NAME.test(column));
      const { rows } = await this.client.query(
        `select ${columns.map(quoteIdent).join(', ')} from public.${quoteIdent(entry.name)}`,
      );
      for (const row of rows) {
        const pk = Object.fromEntries((entry.key_columns || []).map((column) => [column, row?.[column] ?? null]));
        table.set(rowKey(pk), row);
      }
    }
    return state;
  }

  async reEnableTriggers() {
    if (!this.disabledTriggers || !this.client) return;
    for (const entry of this.manifestTables) {
      await this.client.query(`alter table public.${quoteIdent(entry.name)} enable trigger user`).catch(() => {});
    }
    this.disabledTriggers = false;
  }

  async commit() {
    try {
      await this.client.query('commit');
    } finally {
      await this.reEnableTriggers();
      await this.client.end().catch(() => {});
      this.client = null;
    }
  }

  async rollback() {
    try {
      await this.client.query('rollback');
    } finally {
      await this.reEnableTriggers();
      await this.client.end().catch(() => {});
      this.client = null;
    }
  }
}
