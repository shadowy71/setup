/**
 * Durable store adapter for the backup worker / snapshot runner.
 *
 * The incremental path talks to Supabase through PostgREST with the
 * service_role client (RLS-bypassing, server-only). Full snapshots additionally
 * need a direct Postgres connection (`BACKUP_DATABASE_URL`) to read every table
 * inside ONE repeatable-read transaction; PostgREST cannot hold a transaction
 * across requests.
 *
 * No browser code imports this file. It is used by cron route handlers and CLI
 * scripts only — never by a student request path.
 */

import pg from 'pg';

const SELECTABLE_NAME = /^[a-z_][a-z0-9_]*$/;

function quoteIdent(name) {
  if (!SELECTABLE_NAME.test(name)) throw new Error(`unsafe table or column name: ${name}`);
  return `"${name}"`;
}

async function rpc(client, name, args = {}) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(`${name} failed: ${error.message || error.code || 'unknown error'}`);
  return data;
}

/**
 * Insertable columns for a table: generated columns (e.g. posts.search_vector)
 * are computed by Postgres and must not be written during restore.
 */
async function tableColumns(pgClient, table) {
  const { rows } = await pgClient.query(
    `select column_name, data_type, udt_name
       from information_schema.columns
      where table_schema = 'public' and table_name = $1 and is_generated = 'NEVER'
      order by ordinal_position`,
    [table],
  );
  const usable = rows.filter((row) => SELECTABLE_NAME.test(row.column_name));
  if (!usable.length) throw new Error(`no insertable columns found for public.${table}`);
  return {
    columns: usable.map((row) => row.column_name),
    column_types: Object.fromEntries(usable.map((row) => [row.column_name, row.data_type])),
  };
}

export class BackupStore {
  constructor({ client, databaseUrl = null } = {}) {
    if (!client) throw new Error('BackupStore needs a service-role Supabase client');
    this.client = client;
    this.databaseUrl = databaseUrl;
  }

  // ---------------------------------------------------------------- worker --
  async claimBatch({ workerId, batchSize, leaseSeconds }) {
    const rows = await rpc(this.client, 'backup_claim_batch', {
      p_worker_id: workerId,
      p_batch_size: batchSize,
      p_lease_seconds: leaseSeconds,
    });
    return Array.isArray(rows) ? rows[0] || null : rows || null;
  }

  async readChanges({ firstChangeId, lastChangeId }) {
    const rows = await rpc(this.client, 'backup_pending_changes', {
      p_first: firstChangeId,
      p_last: lastChangeId,
    });
    return rows || [];
  }

  async getCheckpoint() {
    const { data, error } = await this.client
      .from('backup_checkpoints')
      .select('last_change_id, last_success_at, last_file_ref, last_content_sha256, last_snapshot_watermark, last_snapshot_at')
      .eq('name', 'primary')
      .maybeSingle();
    if (error) throw new Error(`could not read the backup checkpoint: ${error.message}`);
    return data || null;
  }

  async completeBatch({ workerId, batchId, fileId, sha256, byteSize, manifest }) {
    return rpc(this.client, 'backup_complete_batch', {
      p_worker_id: workerId,
      p_batch_id: batchId,
      p_drive_file_ref: fileId,
      p_sha256: sha256,
      p_byte_size: byteSize,
      p_manifest: manifest,
    });
  }

  async failBatch({ workerId, batchId, error, retryDelaySeconds }) {
    return rpc(this.client, 'backup_fail_batch', {
      p_worker_id: workerId,
      p_batch_id: batchId,
      p_error: error,
      p_retry_delay_seconds: retryDelaySeconds,
    });
  }

  async claimJob(kind, workerId) {
    return rpc(this.client, 'backup_claim_job', { p_kind: kind, p_worker_id: workerId });
  }

  async finishJob(jobId, error = null) {
    if (!jobId) return null;
    return rpc(this.client, 'backup_finish_job', { p_job_id: jobId, p_error: error });
  }

  async listTrackedTables() {
    const { data, error } = await this.client
      .from('backup_tracked_tables')
      .select('schema_name, table_name, key_columns, capture, snapshot')
      .eq('schema_name', 'public')
      .eq('snapshot', true)
      .order('table_name', { ascending: true });
    if (error) throw new Error(`could not read the snapshot catalogue: ${error.message}`);
    return (data || []).map((row) => ({ ...row, columns: [] }));
  }

  // ------------------------------------------------------------ snapshots --
  async snapshotWatermark() {
    const value = await rpc(this.client, 'backup_snapshot_watermark', {});
    return Number(Array.isArray(value) ? value[0] : value);
  }

  /**
   * Read every tracked table inside ONE repeatable-read transaction. The
   * horizon came from `backup_snapshot_watermark()` (a separate short
   * transaction that quiesced the outbox), so any change with id > H —
   * including ones this transaction can already see — is replayed at restore.
   *
   * Mutates `tables[].columns` with the insertable column list for the manifest.
   */
  async readAllTables(tables) {
    if (!this.databaseUrl) {
      throw new Error('BACKUP_DATABASE_URL is required for a full snapshot (a direct Postgres session, not the REST API)');
    }
    const pgClient = new pg.Client({ connectionString: this.databaseUrl, connectionTimeoutMillis: 15000 });
    await pgClient.connect();
    const rowsByTable = {};
    try {
      await pgClient.query('begin isolation level repeatable read read only');
      for (const table of tables) {
        const name = table.table_name || table.name;
        const { columns, column_types: columnTypes } = await tableColumns(pgClient, name);
        table.columns = columns;
        table.column_types = columnTypes;
        const keyColumns = (table.key_columns || []).filter((column) => columns.includes(column));
        const orderBy = keyColumns.length
          ? ` order by ${keyColumns.map(quoteIdent).join(', ')}`
          : '';
        const select = `select ${columns.map(quoteIdent).join(', ')} from public.${quoteIdent(name)}${orderBy}`;
        const accumulated = [];
        const pageSize = 1000;
        for (let offset = 0; ; offset += pageSize) {
          const { rows } = await pgClient.query(`${select} limit $1 offset $2`, [pageSize, offset]);
          accumulated.push(...rows);
          if (rows.length < pageSize) break;
        }
        rowsByTable[name] = accumulated;
      }
      await pgClient.query('commit');
      return rowsByTable;
    } catch (error) {
      await pgClient.query('rollback').catch(() => {});
      throw error;
    } finally {
      await pgClient.end().catch(() => {});
    }
  }

  async startSnapshot({ watermark, previousWatermark, manifest }) {
    const value = await rpc(this.client, 'backup_start_snapshot', {
      p_watermark: watermark,
      p_previous_watermark: previousWatermark,
      p_manifest: manifest,
    });
    return Array.isArray(value) ? value[0] : value;
  }

  async completeSnapshot({ snapshotId, fileId, sha256, byteSize, manifest }) {
    return rpc(this.client, 'backup_complete_snapshot', {
      p_snapshot_id: snapshotId,
      p_drive_file_ref: fileId,
      p_sha256: sha256,
      p_byte_size: byteSize,
      p_manifest: manifest,
    });
  }

  async failSnapshot(snapshotId, error) {
    return rpc(this.client, 'backup_fail_snapshot', { p_snapshot_id: snapshotId, p_error: error });
  }

  // ------------------------------------------------------------ retention --
  async listSnapshots() {
    const { data, error } = await this.client
      .from('backup_snapshots')
      .select('id, watermark, status, created_at, verified_at, drive_file_ref, byte_size')
      .eq('status', 'verified')
      .order('created_at', { ascending: false })
      .limit(400);
    if (error) throw new Error(`could not list snapshots: ${error.message}`);
    return data || [];
  }

  async listBatches() {
    const { data, error } = await this.client
      .from('backup_batches')
      .select('id, kind, status, range_key, first_change_id, last_change_id, snapshot_ref, drive_file_ref, verified_at, created_at')
      .eq('status', 'verified')
      .order('created_at', { ascending: false })
      .limit(2000);
    if (error) throw new Error(`could not list batches: ${error.message}`);
    return data || [];
  }

  async pruneChangeLog({ keepSnapshots, minAgeDays }) {
    const value = await rpc(this.client, 'backup_prune_change_log', {
      p_keep_snapshots: keepSnapshots,
      p_min_age_days: minAgeDays,
    });
    return Number(Array.isArray(value) ? value[0] : value) || 0;
  }

  // ------------------------------------------------------------- OAuth ----
  async getActiveConnection() {
    const { data, error } = await this.client
      .from('backup_drive_connections')
      .select('id, folder_ref, folder_restricted, status, account_label, connected_at, last_success_at, last_error')
      .eq('status', 'active')
      .order('connected_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`could not read the Drive connection: ${error.message}`);
    return data || null;
  }

  async getCredentials(connectionId) {
    const rows = await rpc(this.client, 'backup_private_get_credentials', { p_connection_ref: connectionId });
    return Array.isArray(rows) ? rows[0] || null : rows || null;
  }

  async rotateCredentials(connectionId, sealed) {
    return rpc(this.client, 'backup_private_rotate_credentials', {
      p_connection_ref: connectionId,
      p_ciphertext: sealed.credential_ciphertext,
      p_iv_b64: sealed.iv_b64,
      p_tag_b64: sealed.tag_b64,
      p_key_ref: sealed.key_ref,
    });
  }
}
