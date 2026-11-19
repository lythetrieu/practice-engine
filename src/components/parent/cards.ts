/* The parent's child cards on /account/: numbers from the practice app's saved progress through
   /api/me/app-summary/ (lib/server/appSummary.ts), so the card, the report and the app's Progress screen agree. The
   page's script draws each card with its login tools and fires "family:render"; this fills in [data-sum], [data-status]
   and [data-when], and opens the child's report. Shown per child: practice days and minutes this week, levels finished,
   mistakes waiting in Review, strongest and weakest skills, the score estimate when there is one, and "next up".
   Nicknames are user input: esc() everything. */
import type { AppSummary } from '../../lib/server/appSummary';
import en from '../../i18n/report/en.json';
import { useProfile } from '../../lib/client/profiles';
import { esc, makeTr, type Tr } from './i18n';
import { nextText, showReport, type Row } from './report';

const L: Tr = makeTr('en', en, en);
const pad = (n: number) => String(n).padStart(2, '0');
/** This browser's calendar day, the day the child's "this week" is counted from. */
const localDay = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const ago = (day: string, today: string) => Math.round((Date.parse(today + 'T12:00:00Z') - Date.parse(day + 'T12:00:00Z')) / 864e5);

let rows: Row[] = [];
let stamp = 0;

async function load(force = false) {
  if (!force && Date.now() - stamp < 15_000 && rows.length) return rows;
  const r = await fetch(`/api/me/app-summary/?today=${localDay()}`, { credentials: 'same-origin', cache: 'no-store' });
  const d = (await r.json().catch(() => ({ ok: false }))) as { ok: boolean; error?: string; children?: Row[] };
  if (!d.ok) throw new Error(d.error || 'Could not load progress. Reload to try again.');
  rows = d.children ?? []; stamp = Date.now();
  return rows;
}

const skillList = (xs: AppSummary['weak']) => xs.length
  ? xs.map((x) => `<span class="sk">${esc(x.title)} <small>${esc(L.t('pctRight', { pct: x.pct }))}</small></span>`).join('')
  : '';

function fillCard(card: HTMLElement, r: Row | undefined, today: string) {
  const name = card.dataset.name as string, n = esc(name), id = card.dataset.kid as string;
  const sum = card.querySelector<HTMLElement>('[data-sum]'), status = card.querySelector<HTMLElement>('[data-status]'), when = card.querySelector<HTMLElement>('[data-when]');
  const s = r?.summary;
  if (when) when.textContent = s && s.testIn != null && s.testIn >= 0 ? (s.testIn === 0 ? L.t('testToday') : L.t('testIn', { n: s.testIn }, s.testIn)) : '';
  if (!sum) return;
  if (!s) { sum.innerHTML = ''; return; }
  const next = `<div class="kid-tonight"><div><span>${L.t('tonight_h')}</span><p>${nextText(s, L)}</p></div><button class="btn primary" type="button" data-open-app="${esc(id)}">${L.t('openAs', { name })}</button></div>`;
  if (!s.has) {
    sum.innerHTML = `<p class="kid-empty">${L.t('emptyCard', { name })}</p>${next}`;
    if (status) status.innerHTML = `<span class="kid-st st-few">${L.t('statusNew')}</span>`;
    return;
  }
  const idle = s.last ? ago(s.last, today) : null;
  const st = s.days7 >= 3 ? ['st-strong', L.t('statusActive')] : s.days7 ? ['st-developing', L.t('statusLight')]
    : idle != null && idle >= 7 ? ['st-needs', L.t('statusIdle', { n: idle })] : ['st-developing', L.t('statusQuiet')];
  if (status) status.innerHTML = `<span class="kid-st ${st[0]}">${st[1]}</span>`;
  const dots = s.dots.map((on) => `<i class="${on ? 'on' : ''}"></i>`).join('');
  const e = s.estimate, t = s.target;
  const test = e
    ? `<b>~${L.num(e.mid)}</b><em>${L.t('estimateRange', { lo: L.num(e.lo), hi: L.num(e.hi) })} ${L.t('estimateNote', { label: e.label })}${t ? ` <span class="${t.gap > 0 ? 'down' : 'up'}">${L.t(t.gap > 0 ? 'targetBelow' : 'targetAbove', { gap: L.num(Math.abs(t.gap)), goal: t.label })}</span>` : ''}</em>`
    : `<b>—</b><em>${L.t('noEstimate')}</em>`;
  sum.innerHTML = `<div class="kid-kpis">
      <div><span>${L.t('kpiDays')}</span><b>${s.days7}<small>${L.t('outOf7')}</small></b><em class="kid-dots" role="img" aria-label="${esc(L.t('daysAria'))}">${dots}</em></div>
      <div><span>${L.t('kpiWeek')}</span><b>${L.num(s.min7)}<small> min</small></b><em>${L.num(s.q7)} ${L.t('questionsShort')}</em></div>
      <div><span>${L.t('kpiLevels')}</span><b>${s.done}<small>/${s.total}</small></b><em>${s.mistakes ? L.t('mistakes', { n: L.num(s.mistakes) }, s.mistakes) : L.t('kpiReview') + ': 0'}</em></div>
      <div><span>${L.t('kpiEstimate')}</span>${test}</div>
    </div>
    <div class="kid-skills">
      <div><span>${L.t('kpiStrong')}</span><p>${skillList(s.strong) || `<em>${L.t('noneYet')}</em>`}</p></div>
      <div><span>${L.t('kpiWeak')}</span><p>${skillList(s.weak) || `<em>${L.t('noneBelow', { pct: 70 })}</em>`}</p></div>
    </div>
    ${next}
    <div class="kid-cta"><button class="btn" type="button" data-report="${esc(id)}">${L.t('reportBtn', { name })}</button><span class="note">${s.last ? L.t('lastPracticed', { day: L.day(s.last) }) : ''}</span></div>`;
}

export async function renderCards() {
  const box = document.getElementById('kids');
  if (!box) return;
  const cards = [...box.querySelectorAll<HTMLElement>('[data-kid]')];
  if (!cards.length) return;
  const today = localDay();
  cards.forEach((c) => { const sum = c.querySelector<HTMLElement>('[data-sum]'); if (sum && !sum.children.length) sum.innerHTML = '<p class="note">Loading progress…</p>'; });
  let err = '';
  try { await load(); } catch (e) { err = (e as Error).message; }
  for (const c of cards) {
    if (err) { const sum = c.querySelector('[data-sum]'); if (sum) sum.innerHTML = `<p class="note">${esc(err)}</p>`; continue; }
    fillCard(c, rows.find((x) => x.id === c.dataset.kid), today);
  }
}

/** Opens the practice app as this child: the same profile switch as the app's "Who's practicing?". */
function openApp(kidId: string) {
  const card = document.querySelector<HTMLElement>(`#kids [data-kid="${CSS.escape(kidId)}"]`);
  if (card?.dataset.learner) {
    useProfile({ id: kidId, learner: card.dataset.learner, nickname: card.dataset.name }, { separate: true });
    try { sessionStorage.removeItem('pe.app.who.v1'); } catch { /* storage blocked */ }
  }
  location.href = '/app/#home';
}

/** Wires the page: cards fill on "family:render"; clicks open the app as a child or the child's report. */
export function initParentCards() {
  document.addEventListener('family:render', () => { void renderCards(); });
  document.getElementById('kids')?.addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLElement>('[data-open-app],[data-report]');
    if (!b) return;
    if (b.dataset.openApp) openApp(b.dataset.openApp);
    else if (b.dataset.report) {
      const r = rows.find((x) => x.id === b.dataset.report);
      if (r) void showReport(document.getElementById('report') as HTMLDialogElement, r);
    }
  });
  if (document.querySelector('#kids [data-kid]')) void renderCards();
}
