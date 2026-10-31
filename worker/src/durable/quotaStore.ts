/**
 * Durable Quota Storage Layer and SQLite Migrations
 *
 * Encapsulates all SQL execution, PRAGMA schema inspection, column migrations,
 * and persistence statements for user quotas and daily global counts.
 */

import { UserQuotaRecord } from '../types';

export interface DurableSqlStore {
  sql: any;
  transactionSync<T>(cb: () => T): T;
}

/**
 * Initializes and migrates SQLite tables using PRAGMA inspection to prevent query failures.
 *
 * @param sql - Cloudflare DO SQL handle.
 */
export function initQuotaDatabase(sql: any): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS user_quotas (
      user_hash TEXT PRIMARY KEY,
      window_start INTEGER NOT NULL,
      used_count INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS global_daily_counts (
      day_key TEXT PRIMARY KEY,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      success_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS provider_metrics (
      route_id TEXT PRIMARY KEY,
      ema_ms_per_token REAL NOT NULL,
      sample_count INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  // Migrate user_quotas if attempt_count column is missing
  const userCols = sql.exec(`PRAGMA table_info(user_quotas);`);
  let hasAttempt = false;
  for (const col of userCols) {
    if (col.name === 'attempt_count') {
      hasAttempt = true;
      break;
    }
  }
  if (!hasAttempt) {
    sql.exec(`ALTER TABLE user_quotas ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;`);
    sql.exec(`UPDATE user_quotas SET attempt_count = used_count WHERE attempt_count = 0;`);
  }

  // Migrate global_daily_counts if attempt_count column is missing
  const globalCols = sql.exec(`PRAGMA table_info(global_daily_counts);`);
  let hasGlobalAttempt = false;
  for (const col of globalCols) {
    if (col.name === 'attempt_count') {
      hasGlobalAttempt = true;
      break;
    }
  }
  if (!hasGlobalAttempt) {
    sql.exec(`ALTER TABLE global_daily_counts ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;`);
  }
}

/**
 * Preloads today's persisted global attempt count from SQLite.
 */
export function loadDailyAttempts(sql: any, dayKey: string): number {
  const cursor = sql.exec(`SELECT attempt_count FROM global_daily_counts WHERE day_key = ?`, dayKey);
  for (const row of cursor) {
    return Number(row.attempt_count) || 0;
  }
  return 0;
}

/**
 * Queries user quota record from SQLite. Fails closed (bubbles error) on query failure.
 */
export function queryUserRecord(sql: any, userHash: string): UserQuotaRecord | null {
  const cursor = sql.exec(`SELECT window_start, used_count, attempt_count FROM user_quotas WHERE user_hash = ?`, userHash);
  for (const row of cursor) {
    return {
      windowStart: Number(row.window_start),
      usedCount: Number(row.used_count),
      attemptCount: Number(row.attempt_count),
    };
  }
  return null;
}

/**
 * Persists reservation attempt and window rollover to SQLite within a transaction.
 */
export function persistReservationAttempt(
  sql: any,
  userHash: string,
  record: UserQuotaRecord,
  isRollover: boolean,
  dayKey: string
): void {
  sql.exec(
    `INSERT INTO user_quotas (user_hash, window_start, used_count, attempt_count)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_hash) DO UPDATE SET
       window_start = excluded.window_start,
       used_count = ${isRollover ? '0' : 'user_quotas.used_count'},
       attempt_count = excluded.attempt_count;`,
    userHash,
    record.windowStart,
    record.usedCount,
    record.attemptCount
  );
  sql.exec(
    `INSERT INTO global_daily_counts (day_key, attempt_count, success_count)
     VALUES (?, 1, 0)
     ON CONFLICT(day_key) DO UPDATE SET attempt_count = global_daily_counts.attempt_count + 1;`,
    dayKey
  );
}

/**
 * Persists translation success commit to SQLite within a transaction.
 */
export function persistCommitSuccess(
  sql: any,
  userHash: string,
  windowStart: number,
  usedCount: number,
  dayKey: string
): void {
  sql.exec(
    `UPDATE user_quotas SET used_count = ? WHERE user_hash = ? AND window_start = ?;`,
    usedCount,
    userHash,
    windowStart
  );
  sql.exec(
    `INSERT INTO global_daily_counts (day_key, attempt_count, success_count)
     VALUES (?, 1, 1)
     ON CONFLICT(day_key) DO UPDATE SET success_count = global_daily_counts.success_count + 1;`,
    dayKey
  );
}
