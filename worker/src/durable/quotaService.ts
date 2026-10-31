/**
 * Durable Quota and Atomic Reservation Service
 *
 * Enforces 100 successful translations per rolling 24 hours and a separate 250 attempts durable limit.
 * Bounded by a conservative 10,000 daily admissions cap reflecting Cloudflare SQLite write budget.
 * Uses storage.transactionSync for atomic commits, UUID token identity, and rollback-safe cache cloning.
 */

import { TranslationQuotaInfo, UserQuotaRecord } from '../types';
import {
  DurableSqlStore,
  initQuotaDatabase,
  loadDailyAttempts,
  queryUserRecord,
  persistReservationAttempt,
  persistCommitSuccess,
} from './quotaStore';

export const USER_WINDOW_DURATION_MS = 24 * 60 * 60 * 1000;
export const MAX_USER_QUOTA = 100;
export const MAX_USER_DAILY_ATTEMPTS = 250;
export const CONSERVATIVE_GLOBAL_DAILY_CAP = 10_000;
const MAX_CACHE_ENTRIES = 5000;

export interface ReservationToken {
  id: string;
  userHash: string;
  windowStart: number;
  dayKey: string;
  createdAt: number;
}

export interface QuotaReservationResult {
  allowed: boolean;
  statusCode?: number;
  errorCode?: string;
  errorMessage?: string;
  quota: TranslationQuotaInfo;
  token?: ReservationToken;
}

export class QuotaAccountingService {
  private userQuotaCache = new Map<string, UserQuotaRecord>();
  private activeReservations = new Map<string, ReservationToken>();
  private userReservationCounts = new Map<string, number>();
  private globalDailyAttempts = 0;
  private currentUtcDay = new Date().toISOString().slice(0, 10);

  /** Initializes database tables and schema migrations. */
  initSchema(store: DurableSqlStore): void {
    initQuotaDatabase(store.sql);
  }

  /** Preloads today's persisted global attempt count from SQLite. */
  loadPersistedState(store: DurableSqlStore): void {
    this.currentUtcDay = new Date().toISOString().slice(0, 10);
    this.globalDailyAttempts = loadDailyAttempts(store.sql, this.currentUtcDay);
  }

  private checkAndRotateDay(now = Date.now()): void {
    const today = new Date(now).toISOString().slice(0, 10);
    if (today !== this.currentUtcDay) {
      this.currentUtcDay = today;
      this.globalDailyAttempts = 0;
    }
  }

  private setCachedRecord(userHash: string, record: UserQuotaRecord): void {
    if (this.userQuotaCache.size >= MAX_CACHE_ENTRIES) {
      const firstKey = this.userQuotaCache.keys().next().value;
      if (firstKey) this.userQuotaCache.delete(firstKey);
    }
    this.userQuotaCache.set(userHash, record);
  }

  private getUserRecord(userHash: string, store: DurableSqlStore): UserQuotaRecord | null {
    const cached = this.userQuotaCache.get(userHash);
    if (cached) return cached;
    const record = queryUserRecord(store.sql, userHash);
    if (record) {
      this.setCachedRecord(userHash, record);
    }
    return record;
  }

  /** Read-only query for user quota with active reservations subtracted. */
  getQuota(userHash: string, store: DurableSqlStore, now = Date.now()): TranslationQuotaInfo {
    this.checkAndRotateDay(now);
    const record = this.getUserRecord(userHash, store);
    const inFlight = this.userReservationCounts.get(userHash) || 0;

    if (!record || now >= record.windowStart + USER_WINDOW_DURATION_MS) {
      return {
        remaining: Math.max(0, MAX_USER_QUOTA - inFlight),
        limit: MAX_USER_QUOTA,
        resetsAt: now + USER_WINDOW_DURATION_MS,
      };
    }

    return {
      remaining: Math.max(0, MAX_USER_QUOTA - record.usedCount - inFlight),
      limit: MAX_USER_QUOTA,
      resetsAt: record.windowStart + USER_WINDOW_DURATION_MS,
    };
  }

  /** Atomically reserves quota ticket; persists attempt count in transaction before inference. */
  reserveQuota(userHash: string, store: DurableSqlStore, now = Date.now()): QuotaReservationResult {
    this.checkAndRotateDay(now);

    if (this.globalDailyAttempts >= CONSERVATIVE_GLOBAL_DAILY_CAP) {
      return {
        allowed: false,
        statusCode: 429,
        errorCode: 'global_daily_exhausted',
        errorMessage: 'Global translation pool daily quota exhausted. Resets at 00:00 UTC.',
        quota: { remaining: 0, limit: MAX_USER_QUOTA, resetsAt: now + 3600_000 },
      };
    }

    const existingRecord = this.getUserRecord(userHash, store);
    let isRollover = false;
    let windowStart = now;
    let usedCount = 0;
    let attemptCount = 0;

    if (existingRecord && now < existingRecord.windowStart + USER_WINDOW_DURATION_MS) {
      windowStart = existingRecord.windowStart;
      usedCount = existingRecord.usedCount;
      attemptCount = existingRecord.attemptCount;
    } else {
      isRollover = true;
    }

    const currentReservations = this.userReservationCounts.get(userHash) || 0;

    if (attemptCount >= MAX_USER_DAILY_ATTEMPTS) {
      return {
        allowed: false,
        statusCode: 429,
        errorCode: 'attempt_limit_exceeded',
        errorMessage: `User daily translation attempt limit reached (${MAX_USER_DAILY_ATTEMPTS}/day). Resets at ${new Date(windowStart + USER_WINDOW_DURATION_MS).toISOString()}`,
        quota: { remaining: 0, limit: MAX_USER_QUOTA, resetsAt: windowStart + USER_WINDOW_DURATION_MS },
      };
    }

    if (usedCount + currentReservations >= MAX_USER_QUOTA) {
      return {
        allowed: false,
        statusCode: 429,
        errorCode: 'quota_exhausted',
        errorMessage: `User 24-hour quota exceeded (100/day limit). Resets at ${new Date(windowStart + USER_WINDOW_DURATION_MS).toISOString()}`,
        quota: { remaining: 0, limit: MAX_USER_QUOTA, resetsAt: windowStart + USER_WINDOW_DURATION_MS },
      };
    }

    // Clone record before mutation to ensure transaction rollback leaves memory untainted
    const clonedRecord: UserQuotaRecord = {
      windowStart,
      usedCount,
      attemptCount: attemptCount + 1,
    };

    // Atomic SQLite transaction
    store.transactionSync(() => {
      persistReservationAttempt(store.sql, userHash, clonedRecord, isRollover, this.currentUtcDay);
    });

    // Transaction succeeded: update in-memory state
    this.globalDailyAttempts += 1;
    this.setCachedRecord(userHash, clonedRecord);
    this.userReservationCounts.set(userHash, currentReservations + 1);

    const token: ReservationToken = {
      id: crypto.randomUUID(),
      userHash,
      windowStart,
      dayKey: this.currentUtcDay,
      createdAt: now,
    };
    this.activeReservations.set(token.id, token);

    return {
      allowed: true,
      token,
      quota: {
        remaining: Math.max(0, MAX_USER_QUOTA - usedCount - (currentReservations + 1)),
        limit: MAX_USER_QUOTA,
        resetsAt: windowStart + USER_WINDOW_DURATION_MS,
      },
    };
  }

  /** Commits a successful translation atomically in SQLite before updating memory. */
  commitSuccess(token: ReservationToken, store: DurableSqlStore): TranslationQuotaInfo {
    if (!this.activeReservations.has(token.id)) {
      throw new Error('Reservation token already settled or invalid');
    }

    const currentRecord = this.getUserRecord(token.userHash, store);
    if (!currentRecord) {
      throw new Error('User quota record not found for active reservation');
    }

    const isSameWindow = currentRecord.windowStart === token.windowStart;
    const nextUsedCount = isSameWindow ? currentRecord.usedCount + 1 : currentRecord.usedCount;

    const clonedRecord: UserQuotaRecord = {
      ...currentRecord,
      usedCount: nextUsedCount,
    };

    // Atomic SQLite transaction
    store.transactionSync(() => {
      persistCommitSuccess(store.sql, token.userHash, token.windowStart, nextUsedCount, token.dayKey);
    });

    // Settle memory state
    this.activeReservations.delete(token.id);
    const activeUserCount = this.userReservationCounts.get(token.userHash) || 1;
    this.userReservationCounts.set(token.userHash, Math.max(0, activeUserCount - 1));
    this.setCachedRecord(token.userHash, clonedRecord);

    const remainingReservations = this.userReservationCounts.get(token.userHash) || 0;
    return {
      remaining: Math.max(0, MAX_USER_QUOTA - nextUsedCount - remainingReservations),
      limit: MAX_USER_QUOTA,
      resetsAt: token.windowStart + USER_WINDOW_DURATION_MS,
    };
  }

  /** Releases an in-flight reservation on failure without consuming from success quota. */
  releaseReservation(token: ReservationToken): void {
    if (!this.activeReservations.has(token.id)) {
      return; // Exact-once release
    }
    this.activeReservations.delete(token.id);

    const activeUserCount = this.userReservationCounts.get(token.userHash) || 1;
    this.userReservationCounts.set(token.userHash, Math.max(0, activeUserCount - 1));
  }
}
