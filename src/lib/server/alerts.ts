/* Alerts to the site operator: an email when a student reports a question or an app problem, or when a new kind of app
   error shows up. At most one email per kind every 15 minutes (the next one says how many more came in); everything
   is always saved in the database either way (tables reports and app_errors).
   Off until ALERT_EMAIL (wrangler.jsonc var, comma-separated) is set and the EMAIL binding exists. Never includes a
   name, an email or free text: reports carry only fixed reasons, and error messages are already cleaned (api/app-error.ts). */
import { config } from '../../pack';
import { bindings, type D1Database } from './env';

const WINDOW_MS = 15 * 60_000;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

export type AlertKind = 'report' | 'app-problem' | 'app-error';

/** Sends (or holds back, inside the 15-minute window) one alert. Never throws: an alert must not break the request. */
export async function alertOwner(D: D1Database, kind: AlertKind, subject: string, lines: string[], table: 'reports' | 'app_errors') {
  try {
    const to = (bindings.ALERT_EMAIL ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!to.length || !bindings.EMAIL || import.meta.env.DEV) return;
    const key = `alert:${kind}`, now = Date.now();
    const row = await D.prepare('SELECT value FROM meta WHERE key = ?1').bind(key).first<{ value: string }>();
    const prev = row ? (JSON.parse(row.value) as { at: number; held: number }) : { at: 0, held: 0 };
    if (now - prev.at < WINDOW_MS) {
      await D.prepare('INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .bind(key, JSON.stringify({ at: prev.at, held: prev.held + 1 })).run();
      return;
    }
    await D.prepare('INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .bind(key, JSON.stringify({ at: now, held: 0 })).run();
    const more = prev.held ? [`Also ${prev.held} more of this kind since the last email.`] : [];
    const text = [...lines, ...more, '', `See the ${table} table in your database (newest rows last).`].join('\n');
    const html = `<div style="font:15px/1.5 Arial,Helvetica,sans-serif;color:#1d2521">${[...lines, ...more].map((l) => `<p style="margin:0 0 6px">${esc(l)}</p>`).join('')}
<p style="margin:14px 0 0">See the ${esc(table)} table in your database (newest rows last).</p></div>`;
    for (const addr of to) {
      await bindings.EMAIL.send({ to: addr, from: { email: bindings.MAIL_FROM || 'login@example.com', name: `${config.name} alerts` }, subject: `[${config.exam}] ${subject}`, text, html });
    }
  } catch (e) {
    console.error('alert', kind, (e as { code?: string }).code ?? (e as Error).message);
  }
}
