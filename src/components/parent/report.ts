/* A child's practice in the app, as a list of plain sentences: the same numbers as the child card on /account/ (from
   /api/me/app-summary/), so the report, the card and the app's Progress screen agree. Words come from
   src/i18n/report/<code>.json (i18n.ts); English only is shipped. Nicknames are user input: the translator escapes
   every value it fills in. */
import type { AppSummary } from '../../lib/server/appSummary';
import en from '../../i18n/report/en.json';
import { LANG_LIST, browserLang, esc, makeTr, saveLang, savedLang, type Strings, type Tr } from './i18n';

export interface Row { id: string; nickname: string; grade: number | null; summary: AppSummary | null }

// Other languages are loaded only when picked.
const FILES = import.meta.glob<{ default: Strings }>(['../../i18n/report/*.json', '!../../i18n/report/en.json']);
async function strings(code: string): Promise<Strings> {
  if (code === 'en') return en;
  const load = FILES[`../../i18n/report/${code}.json`];
  try { return load ? (await load()).default : en; } catch { return en; }   // offline before it was ever loaded: English
}

/** The "next up" sentence for a summary, or the all-done line. */
export function nextText(s: AppSummary, L: Tr): string {
  const n = s.next;
  if (!n) return L.t('allDone');
  return L.t(n.kind === 'resume' ? 'nextResume' : n.kind === 'retry' ? 'nextRetry' : 'nextStart', { level: L.num(n.level), world: n.world, title: n.title, minutes: L.num(n.minutes) });
}

/** The report for one child, as HTML. */
export function reportHtml(r: Row, L: Tr): string {
  const s = r.summary, { t, num } = L, name = r.nickname;
  if (!s || !s.has) return `<h2>${t('appTitle', { name })}</h2><p>${t('none', { name })}</p>${s ? `<p class="aw-tonight"><b>${t('tonight_h')}</b> ${nextText(s, L)}</p>` : ''}`;
  const e = s.estimate, tg = s.target;
  const skills = (xs: AppSummary['weak']) => L.list(xs.map((x) => `${esc(x.title)} (${num(x.pct)}%)`));
  return `<h2>${t('appTitle', { name })}</h2>
    <ul class="aw-list">
      <li>${s.last ? t('days7Last', { n: num(s.days7), day: L.day(s.last) }) : t('days7', { n: num(s.days7) })}</li>
      <li>${t('week', { q: num(s.q7), m: num(s.min7) })}</li>
      <li>${t('levels', { n: num(s.done), total: num(s.total) }, s.done)}${s.mistakes ? ` ${t('mistakes', { n: num(s.mistakes) }, s.mistakes)}` : ''}</li>
      ${s.strong.length ? `<li>${t('strong', { skills: '\u0000' }).replace('\u0000', skills(s.strong))}</li>` : ''}
      ${s.weak.length ? `<li>${t('weak', { skills: '\u0000' }).replace('\u0000', skills(s.weak))}</li>` : ''}
      ${!s.strong.length && !s.weak.length ? `<li>${t('noSkills')}</li>` : ''}
      ${e ? `<li>${t('estimate', { mid: num(e.mid), lo: num(e.lo), hi: num(e.hi) })} ${t('estimateNote', { label: e.label })}${tg ? ` ${t(tg.gap > 0 ? 'targetBelow' : 'targetAbove', { gap: num(Math.abs(tg.gap)), goal: tg.label })}` : ''}</li>` : ''}
      ${s.testIn != null ? `<li>${s.testIn === 0 ? t('testToday') : t('testIn', { n: num(s.testIn) }, s.testIn)}</li>` : ''}
    </ul>
    <p class="aw-tonight"><b>${t('tonight_h')}</b> ${nextText(s, L)}</p>`;
}

/** Fills the report dialog for one child; with more than one language, a picker comes first. */
export async function showReport(dlg: HTMLDialogElement, r: Row) {
  const body = dlg.querySelector<HTMLElement>('#report-body');
  if (!body) return;
  const draw = async (code: string) => {
    const s = await strings(code), L = makeTr(code, s, en);
    const picker = LANG_LIST.length > 1
      ? `<div class="aw-lang no-print"><label for="aw-pick">${esc(s.pickLabel || en.pickLabel)}</label>
         <select id="aw-pick">${LANG_LIST.map((l) => `<option value="${l.code}" lang="${l.code}"${l.code === code ? ' selected' : ''}>${esc(l.label)}</option>`).join('')}</select></div>` : '';
    body.innerHTML = `${picker}<div lang="${esc(code)}" dir="${L.dir === 'rtl' ? 'rtl' : 'ltr'}">${reportHtml(r, L)}</div>`;
    body.querySelector<HTMLSelectElement>('#aw-pick')?.addEventListener('change', (e) => { const v = (e.target as HTMLSelectElement).value; saveLang(v); void draw(v); });
    dlg.querySelector<HTMLElement>('#report-print')!.textContent = s.print || en.print;
    dlg.querySelector<HTMLElement>('#report-close')!.textContent = s.close || en.close;
  };
  await draw(savedLang() ?? browserLang());
  dlg.showModal();
}
