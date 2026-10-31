import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import {
  QuotaAccountingService,
  MAX_USER_QUOTA,
  MAX_USER_DAILY_ATTEMPTS,
  CONSERVATIVE_GLOBAL_DAILY_CAP,
  USER_WINDOW_DURATION_MS,
} from '../src/durable/quotaService';
import { DurableSqlStore } from '../src/durable/quotaStore';

/**
 * Real SQLite storage adapter wrapping Node's in-memory DatabaseSync
 * to match Cloudflare Durable Object SQL interface (sql.exec) and transactionSync.
 */
class RealSqlStorage implements DurableSqlStore {
  public db: DatabaseSync;
  public sql: any;

  constructor(db?: DatabaseSync) {
    this.db = db || new DatabaseSync(':memory:');
    this.sql = {
      exec: (query: string, ...params: any[]) => this.exec(query, ...params),
    };
  }

  exec(query: string, ...params: any[]): any[] {
    const trimmed = query.trim();
    if (trimmed.toUpperCase().startsWith('SELECT') || trimmed.toUpperCase().startsWith('PRAGMA')) {
      const stmt = this.db.prepare(query);
      return stmt.all(...params) as any[];
    }
    if (params.length > 0) {
      const stmt = this.db.prepare(query);
      stmt.run(...params);
      return [];
    }
    this.db.exec(query);
    return [];
  }

  transactionSync<T>(cb: () => T): T {
    this.db.exec('BEGIN TRANSACTION;');
    try {
      const result = cb();
      this.db.exec('COMMIT;');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }
  }
}

describe('Production QuotaAccountingService & Real SQLite Migrations', () => {
  let store: RealSqlStorage;
  let quotaService: QuotaAccountingService;

  beforeEach(() => {
    store = new RealSqlStorage();
    quotaService = new QuotaAccountingService();
  });

  it('migrates legacy user_quotas table lacking attempt_count and seeds values', () => {
    // 1. Manually create pre-existing legacy table WITHOUT attempt_count
    store.db.exec(`
      CREATE TABLE user_quotas (
        user_hash TEXT PRIMARY KEY,
        window_start INTEGER NOT NULL,
        used_count INTEGER NOT NULL
      );
    `);
    store.db.prepare(`INSERT INTO user_quotas VALUES (?, ?, ?)`).run('legacy-user-1', 1700000000000, 42);

    // 2. Initialize schema: PRAGMA inspection must add attempt_count and seed from used_count
    quotaService.initSchema(store);

    // 3. Verify column exists in schema
    const cols = store.exec(`PRAGMA table_info(user_quotas);`);
    const colNames = cols.map((c: any) => c.name);
    expect(colNames).toContain('attempt_count');

    // 4. Verify existing record was seeded with attempt_count = used_count
    const rows = store.exec(`SELECT * FROM user_quotas WHERE user_hash = ?`, 'legacy-user-1');
    expect(rows[0].attempt_count).toBe(42);
    expect(rows[0].used_count).toBe(42);
  });

  it('enforces 100/day user success limit with atomic reservations', () => {
    quotaService.initSchema(store);
    const user = 'test-user-100';
    const now = 1700000000000;

    // Reserve and commit 100 tickets
    for (let i = 0; i < MAX_USER_QUOTA; i++) {
      const res = quotaService.reserveQuota(user, store, now + i * 100);
      expect(res.allowed).toBe(true);
      quotaService.commitSuccess(res.token!, store);
    }

    // 101st reservation must be blocked
    const overflowRes = quotaService.reserveQuota(user, store, now + 101 * 100);
    expect(overflowRes.allowed).toBe(false);
    expect(overflowRes.errorCode).toBe('quota_exhausted');
    expect(overflowRes.quota.remaining).toBe(0);
  });

  it('enforces 250/day durable attempt limit against runaway retries', () => {
    quotaService.initSchema(store);
    const user = 'flapping-retry-user';
    const now = 1700000000000;

    // Simulate 250 failed attempts (releases reservation without success commit)
    for (let i = 0; i < MAX_USER_DAILY_ATTEMPTS; i++) {
      const res = quotaService.reserveQuota(user, store, now + i * 50);
      expect(res.allowed).toBe(true);
      quotaService.releaseReservation(res.token!);
    }

    // 251st attempt must be blocked by durable attempt limit
    const blockedRes = quotaService.reserveQuota(user, store, now + 251 * 50);
    expect(blockedRes.allowed).toBe(false);
    expect(blockedRes.errorCode).toBe('attempt_limit_exceeded');
  });

  it('guarantees exact-once reservation release with duplicate release immunity', () => {
    quotaService.initSchema(store);
    const user = 'dup-release-user';
    const now = 1700000000000;

    const res = quotaService.reserveQuota(user, store, now);
    expect(res.allowed).toBe(true);

    // First release
    quotaService.releaseReservation(res.token!);

    // Second release with same token: safe no-op
    expect(() => quotaService.releaseReservation(res.token!)).not.toThrow();

    const quota = quotaService.getQuota(user, store, now);
    expect(quota.remaining).toBe(MAX_USER_QUOTA);
  });

  it('atomically resets used_count to 0 on 24-hour window rollover', () => {
    quotaService.initSchema(store);
    const user = 'rollover-user';
    const t0 = 1700000000000;

    // Consume 50 requests
    for (let i = 0; i < 50; i++) {
      const res = quotaService.reserveQuota(user, store, t0 + i * 10);
      quotaService.commitSuccess(res.token!, store);
    }

    let quota = quotaService.getQuota(user, store, t0 + 1000);
    expect(quota.remaining).toBe(50);

    // Advance past 24-hour window
    const tNextDay = t0 + USER_WINDOW_DURATION_MS + 5000;
    const resNew = quotaService.reserveQuota(user, store, tNextDay);
    expect(resNew.allowed).toBe(true);
    quotaService.commitSuccess(resNew.token!, store);

    quota = quotaService.getQuota(user, store, tNextDay);
    // After 1 request in new window, remaining should be 99
    expect(quota.remaining).toBe(99);
  });

  it('preserves quota state across crash/restart simulation via SQLite', () => {
    quotaService.initSchema(store);
    const user = 'persist-user';
    const now = 1700000000000;

    // Run 10 translations on instance 1
    for (let i = 0; i < 10; i++) {
      const res = quotaService.reserveQuota(user, store, now + i * 10);
      quotaService.commitSuccess(res.token!, store);
    }

    // Simulate DO restart: create instance 2 against the exact same SQLite database
    const instance2 = new QuotaAccountingService();
    instance2.initSchema(store);
    instance2.loadPersistedState(store);

    const quotaAfterRestart = instance2.getQuota(user, store, now + 1000);
    expect(quotaAfterRestart.remaining).toBe(90);
    expect(quotaAfterRestart.limit).toBe(100);
  });

  it('reserves the last allowance against concurrent requests before either settles', () => {
    quotaService.initSchema(store);
    const now = Date.now();
    store.db.prepare('INSERT INTO user_quotas VALUES (?, ?, ?, ?)').run('last-ticket', now, 99, 99);
    const reservation = quotaService.reserveQuota('last-ticket', store, now);
    expect(reservation.allowed).toBe(true);
    expect(quotaService.reserveQuota('last-ticket', store, now).allowed).toBe(false);
    quotaService.releaseReservation(reservation.token!);
    expect(quotaService.getQuota('last-ticket', store, now).remaining).toBe(1);
  });

  it('keeps failed admissions counted in the global cap across restarts', () => {
    quotaService.initSchema(store);
    const now = Date.now();
    const day = new Date(now).toISOString().slice(0, 10);
    store.db.prepare('INSERT INTO global_daily_counts VALUES (?, ?, ?)').run(day, CONSERVATIVE_GLOBAL_DAILY_CAP - 1, 0);
    quotaService.loadPersistedState(store);
    const reservation = quotaService.reserveQuota('final-admission', store, now);
    expect(reservation.allowed).toBe(true);
    quotaService.releaseReservation(reservation.token!);
    const restarted = new QuotaAccountingService();
    restarted.loadPersistedState(store);
    expect(restarted.reserveQuota('another-user', store, now).errorCode).toBe('global_daily_exhausted');
    expect(restarted.getQuota('final-admission', store, now).remaining).toBe(MAX_USER_QUOTA);
  });

  it('does not charge a new user window when an older-window inference completes', () => {
    quotaService.initSchema(store);
    const now = Date.now();
    const old = quotaService.reserveQuota('crossing-window', store, now);
    const later = now + USER_WINDOW_DURATION_MS + 1;
    const current = quotaService.reserveQuota('crossing-window', store, later);
    quotaService.commitSuccess(old.token!, store);
    expect(quotaService.getQuota('crossing-window', store, later).remaining).toBe(99);
    quotaService.commitSuccess(current.token!, store);
    expect(quotaService.getQuota('crossing-window', store, later).remaining).toBe(99);
  });

  it('rolls back a partial success transaction without mutating cached counters', () => {
    quotaService.initSchema(store);
    const now = Date.now();
    const reservation = quotaService.reserveQuota('commit-failure', store, now);
    const failing: DurableSqlStore = {
      sql: {
        exec: (query: string, ...params: unknown[]) => {
          if (query.includes('INSERT INTO global_daily_counts')) throw new Error('Injected commit failure');
          return store.exec(query, ...params);
        },
      },
      transactionSync: (callback) => store.transactionSync(callback),
    };
    expect(() => quotaService.commitSuccess(reservation.token!, failing)).toThrow('Injected commit failure');
    expect(store.db.prepare('SELECT used_count FROM user_quotas WHERE user_hash = ?').get('commit-failure')?.used_count).toBe(0);
    quotaService.commitSuccess(reservation.token!, store);
    expect(quotaService.getQuota('commit-failure', store, now).remaining).toBe(99);
    expect(() => quotaService.commitSuccess(reservation.token!, store)).toThrow();
  });

  it('ensures injected transaction failure leaves in-memory cache and SQL uncorrupted', () => {
    quotaService.initSchema(store);
    const user = 'fail-user';
    const now = 1700000000000;

    // First successful request
    const res1 = quotaService.reserveQuota(user, store, now);
    quotaService.commitSuccess(res1.token!, store);
    expect(quotaService.getQuota(user, store, now).remaining).toBe(99);

    // Inject failure into transactionSync
    const faultyStore: DurableSqlStore = {
      sql: store.sql,
      transactionSync: () => {
        throw new Error('Injected SQL write failure');
      },
    };

    // Second reservation attempts transaction write: throws error
    expect(() => quotaService.reserveQuota(user, faultyStore, now + 1000)).toThrow('Injected SQL write failure');

    // In-memory cache must remain untainted (used: 1, attempts: 1)
    const quotaAfterFail = quotaService.getQuota(user, store, now + 1000);
    expect(quotaAfterFail.remaining).toBe(99);

    const dbRow = store.exec('SELECT * FROM user_quotas WHERE user_hash = ?', user)[0];
    expect(dbRow.used_count).toBe(1);
    expect(dbRow.attempt_count).toBe(1);
  });
});
