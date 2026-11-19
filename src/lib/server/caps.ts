/* Site-wide daily caps on writes anyone can trigger (problem reports, app errors), against floods that
   would use up D1's daily write quota and stop sign-in for everyone.
   The count lives in meta under cap_<name>_YYYY-MM-DD and only ever goes up, so deleting rows ("Erase my
   saved results") can't reset it; retention.ts drops the keys of past days. */
import type { D1Database } from './env';

/** Counts one write for today; false once `cap` writes were counted today. One statement, atomic. */
export async function underDailyCap(D: D1Database, name: string, cap: number, at: string): Promise<boolean> {
  const row = await D.prepare(`INSERT INTO meta (key, value) VALUES (?1, '1')
      ON CONFLICT(key) DO UPDATE SET value = CAST(meta.value AS INTEGER) + 1 WHERE CAST(meta.value AS INTEGER) < ?2
    RETURNING value`).bind(`cap_${name}_${at.slice(0, 10)}`, cap).first();
  return !!row;
}

/** Counts `n` writes for today in one step; false (and nothing counted) when that would pass `cap`. One statement,
    atomic, like underDailyCap. For batches: the answer log saves up to 200 rows a request. */
export async function addUnderDailyCap(D: D1Database, name: string, n: number, cap: number, at: string): Promise<boolean> {
  if (n <= 0) return true;
  if (n > cap) return false;
  const row = await D.prepare(`INSERT INTO meta (key, value) VALUES (?1, ?3)
      ON CONFLICT(key) DO UPDATE SET value = CAST(meta.value AS INTEGER) + ?3 WHERE CAST(meta.value AS INTEGER) + ?3 <= ?2
    RETURNING value`).bind(`cap_${name}_${at.slice(0, 10)}`, cap, n).first();
  return !!row;
}
