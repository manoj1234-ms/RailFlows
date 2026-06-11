/**
 * Partition Maintainer Service
 *
 * Fallback for when pg_partman is unavailable (managed Postgres, RDS, etc.).
 * Runs at startup and every 24 h to:
 *   1. CREATE child partitions for the next 3 months (bookings) / 2 years (audit_logs)
 *   2. Detach + archive partitions older than the retention window
 *
 * All operations are idempotent — safe to run multiple times.
 */

import { Pool } from 'pg';
import logger from '../utils/logger';

/** How far ahead to pre-create child partitions */
const BOOKINGS_PREMAKE_MONTHS = 3;
const AUDIT_PREMAKE_YEARS = 2;

/** Retention: detach (not drop) partitions older than these limits */
const BOOKINGS_RETENTION_MONTHS = 36;
const AUDIT_RETENTION_YEARS = 2;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** ISO date string for the first day of a given year+month */
function monthStart(year: number, month: number): string {
  return `${year}-${pad(month)}-01`;
}

/** Advance a {year, month} by N months */
function addMonths(year: number, month: number, n: number): { year: number; month: number } {
  const total = (year * 12 + (month - 1)) + n;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

async function ensureBookingsPartitions(pool: Pool): Promise<void> {
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;

  for (let i = 0; i <= BOOKINGS_PREMAKE_MONTHS; i++) {
    const { year, month } = addMonths(curYear, curMonth, i);
    const partName = `bookings_p_${year}_${pad(month)}`;
    const fromDate = monthStart(year, month);
    const { year: toYear, month: toMonth } = addMonths(year, month, 1);
    const toDate = monthStart(toYear, toMonth);

    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ${partName}
          PARTITION OF bookings_partitioned
          FOR VALUES FROM ('${fromDate}') TO ('${toDate}')
      `);
      logger.info({ msg: '[PartitionMaintainer] Partition ensured', table: partName });
    } catch (err: any) {
      // Partition may already exist with different bounds — log and continue
      if (!err.message.includes('already exists')) {
        logger.warn({ msg: '[PartitionMaintainer] Could not create bookings partition', partName, error: err.message });
      }
    }
  }
}

async function ensureAuditLogPartitions(pool: Pool): Promise<void> {
  const curYear = new Date().getFullYear();

  for (let i = 0; i <= AUDIT_PREMAKE_YEARS; i++) {
    const year = curYear + i;
    const partName = `audit_logs_p_${year}`;

    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ${partName}
          PARTITION OF audit_logs_partitioned
          FOR VALUES FROM ('${year}-01-01') TO ('${year + 1}-01-01')
      `);
      logger.info({ msg: '[PartitionMaintainer] Partition ensured', table: partName });
    } catch (err: any) {
      if (!err.message.includes('already exists')) {
        logger.warn({ msg: '[PartitionMaintainer] Could not create audit_logs partition', partName, error: err.message });
      }
    }
  }
}

async function archiveOldBookingsPartitions(pool: Pool): Promise<void> {
  /**
   * Find child partitions of bookings_partitioned that are entirely
   * before the retention cutoff and detach them from the parent.
   * (Actual archival/drop is a DBA decision and NOT done automatically.)
   */
  const now = new Date();
  const cutoffDate = new Date(now);
  cutoffDate.setMonth(cutoffDate.getMonth() - BOOKINGS_RETENTION_MONTHS);

  const { rows } = await pool.query<{ child_schema: string; child_table: string; partition_range: string }>(`
    SELECT
      nmsp_child.nspname AS child_schema,
      child.relname      AS child_table,
      pg_get_expr(child.relpartbound, child.oid) AS partition_range
    FROM pg_inherits
    JOIN pg_class parent  ON pg_inherits.inhparent = parent.oid
    JOIN pg_class child   ON pg_inherits.inhrelid  = child.oid
    JOIN pg_namespace nmsp_child ON nmsp_child.oid = child.relnamespace
    WHERE parent.relname = 'bookings_partitioned'
      AND pg_get_expr(child.relpartbound, child.oid) LIKE '%FROM%'
  `);

  for (const row of rows) {
    // Extract the FROM date from the partition bound expression
    const match = row.partition_range.match(/FROM \('([^']+)'\)/);
    if (!match) continue;

    const partStart = new Date(match[1]);
    if (partStart < cutoffDate) {
      try {
        await pool.query(`
          ALTER TABLE bookings_partitioned
            DETACH PARTITION "${row.child_schema}"."${row.child_table}" CONCURRENTLY
        `);
        logger.warn({
          msg: '[PartitionMaintainer] Detached old partition (past retention)',
          table: row.child_table,
          partStart: partStart.toISOString(),
          retentionMonths: BOOKINGS_RETENTION_MONTHS,
        });
      } catch (err: any) {
        logger.warn({ msg: '[PartitionMaintainer] Could not detach partition', table: row.child_table, error: err.message });
      }
    }
  }
}

async function runMaintenanceCycle(pool: Pool): Promise<void> {
  logger.info('[PartitionMaintainer] Running maintenance cycle...');
  try {
    await ensureBookingsPartitions(pool);
    await ensureAuditLogPartitions(pool);
    await archiveOldBookingsPartitions(pool);
    logger.info('[PartitionMaintainer] Maintenance cycle complete');
  } catch (err: any) {
    logger.error({ msg: '[PartitionMaintainer] Maintenance cycle error', error: err.message });
  }
}

const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
let _maintainerId: ReturnType<typeof setInterval> | null = null;

export function startPartitionMaintainer(pool: Pool): void {
  logger.info('[PartitionMaintainer] Starting partition maintainer...');

  // Run immediately on startup (non-blocking)
  runMaintenanceCycle(pool).catch(() => {});

  // Schedule daily
  _maintainerId = setInterval(() => {
    runMaintenanceCycle(pool).catch(() => {});
  }, INTERVAL_MS);
}

export function stopPartitionMaintainer(): void {
  if (_maintainerId) {
    clearInterval(_maintainerId);
    _maintainerId = null;
    logger.info('[PartitionMaintainer] Stopped');
  }
}
