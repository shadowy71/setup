import { describe, expect, it, vi } from 'vitest';
import { getAdminDashboardCounts } from '../lib/data/admin';

const TABLES = [
  'profiles', 'posts', 'comments', 'reactions', 'communities', 'marketplace_listings',
  'gigs', 'events', 'notices', 'reports', 'messages', 'random_sessions',
];

function snapshot() {
  return {
    counts: Object.fromEntries(TABLES.map((table, index) => [table, index + 1])),
    activeUsers24h: null,
    overview: {
      pendingReports: 2,
      pendingListings: 3,
      suspended: 4,
      disabledFlags: 5,
    },
  };
}

describe('Admin dashboard count batching', () => {
  it('returns the exact RPC snapshot, including key order and the deliberate null, without table queries', async () => {
    const data = snapshot();
    // PostgREST/JSONB implementations may reorder object keys. The adapter,
    // not the transport serializer, owns the original presentation order.
    data.counts = Object.fromEntries(Object.entries(data.counts).reverse());
    const supabase = {
      rpc: vi.fn().mockResolvedValue({ data, error: null }),
      from: vi.fn(),
    };

    const result = await getAdminDashboardCounts(supabase);

    expect(result).toEqual(data);
    expect(Object.keys(result.counts)).toEqual(TABLES);
    expect(result.activeUsers24h).toBeNull();
    expect(supabase.rpc).toHaveBeenCalledExactlyOnceWith('campus_admin_dashboard_counts');
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('retains all sixteen exact-count fallbacks and their no-throw/null behavior if the RPC is unavailable', async () => {
    const data = snapshot();
    const selects = [];
    const filters = [];
    const supabase = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'not installed' } }),
      from(table) {
        return {
          select(_columns, options) {
            selects.push({ table, options });
            const query = Promise.resolve({ count: data.counts[table] });
            query.eq = (column, value) => {
              filters.push({ table, column, value });
              const key = {
                'reports.status.pending': 'pendingReports',
                'marketplace_listings.status.pending': 'pendingListings',
                'profile_private.account_status.suspended': 'suspended',
                'feature_flags.enabled.false': 'disabledFlags',
              }[`${table}.${column}.${value}`];
              return Promise.resolve({ count: data.overview[key] });
            };
            return query;
          },
        };
      },
    };

    const result = await getAdminDashboardCounts(supabase);

    expect(result).toEqual(data);
    expect(selects).toHaveLength(16);
    expect(selects.every((call) => call.options.count === 'exact' && call.options.head === true)).toBe(true);
    expect(selects.map((call) => call.table)).toEqual([
      ...TABLES, 'reports', 'marketplace_listings', 'profile_private', 'feature_flags',
    ]);
    expect(filters).toEqual([
      { table: 'reports', column: 'status', value: 'pending' },
      { table: 'marketplace_listings', column: 'status', value: 'pending' },
      { table: 'profile_private', column: 'account_status', value: 'suspended' },
      { table: 'feature_flags', column: 'enabled', value: false },
    ]);
    expect(result.activeUsers24h).toBeNull();
  });
});
