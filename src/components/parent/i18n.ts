/* The parent's pages in words from a string file (src/i18n/report/<code>.json): the child cards on /account/ (cards.ts)
   and the child's report (report.ts). Only English ships. The mechanism is kept so a site can add a language: put a
   <code>.json next to en.json (any key it lacks falls back to English), add the language to LANG_LIST, and
   report.ts offers a picker. Wording that names the exam uses {exam}, filled in from the pack (config.exam), so the
   same strings serve every exam. Skill, level and section names come from the pack and are shown as the child sees them. */
import { config } from '../../pack';

export type Strings = Record<string, string>;

export const LANG_LIST: { code: string; label: string; dir: 'ltr' | 'rtl' }[] = [
  { code: 'en', label: 'English', dir: 'ltr' },
];
export const LANG_KEY = `pe.${config.id}.lang.v1`;

export const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** The saved choice, when it is one of ours. */
export function savedLang(): string | null {
  try { const v = localStorage.getItem(LANG_KEY); return LANG_LIST.some((l) => l.code === v) ? v : null; } catch { return null; }
}
export function saveLang(code: string) { try { localStorage.setItem(LANG_KEY, code); } catch { /* storage blocked */ } }

/** The browser's language, when it is one of ours; else English. */
export function browserLang(langs: readonly string[] = typeof navigator !== 'undefined' ? navigator.languages || [navigator.language] : []): string {
  for (const raw of langs) {
    const base = String(raw || '').toLowerCase().split('-')[0];
    if (LANG_LIST.some((x) => x.code === base)) return base;
  }
  return 'en';
}

export interface Tr {
  code: string; dir: string;
  /** The string for `key` with {vars} filled in (escaped). With `n`, the plural form for n (key_one, key_few, ... key_other). */
  t: (key: string, vars?: Record<string, string | number>, n?: number) => string;
  num: (n: number) => string;
  /** "Oct 29" for a YYYY-MM-DD day. */
  day: (d: string) => string;
  list: (xs: string[]) => string;
}

/** A translator over `s`, falling back to the English `en` for a key the translation lacks. {exam} and {site} are always filled in. */
export function makeTr(code: string, s: Strings, en: Strings): Tr {
  const tag = s.tag || en.tag, rules = new Intl.PluralRules(tag), enRules = new Intl.PluralRules(en.tag);
  const nf = new Intl.NumberFormat(tag);
  const base: Record<string, string> = { exam: config.exam, site: config.name };
  const pick = (key: string, n?: number) => {
    if (n != null) {
      const v = s[`${key}_${rules.select(n)}`] ?? s[`${key}_other`] ?? s[key];
      if (v != null) return v;
      return en[`${key}_${enRules.select(n)}`] ?? en[`${key}_other`] ?? en[key] ?? key;
    }
    return s[key] ?? en[key] ?? key;
  };
  const utc = (d: string) => new Date(d + 'T12:00:00Z');
  let list: Intl.ListFormat | null = null;
  try { list = new Intl.ListFormat(tag, { type: 'conjunction' }); } catch { /* old browser */ }
  return {
    code, dir: s.dir || 'ltr',
    t: (key, vars = {}, n) => pick(key, n).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? esc(vars[k]) : k in base ? esc(base[k]) : m)),
    num: (n) => nf.format(n),
    day: (d) => new Intl.DateTimeFormat(tag, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(utc(d)),
    list: (xs) => (list ? list.format(xs) : xs.join(', ')),
  };
}
