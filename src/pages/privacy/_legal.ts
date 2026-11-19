// The facts the privacy notice and the terms take from the pack (pack.yaml `legal`), with clear placeholders when the
// block is missing. Shared by src/pages/privacy/ and src/pages/terms/ (the leading underscore keeps this file out of the routes).
import { config } from '../../pack';

const L = config.legal;
const long = (d: string) => {
  const t = Date.parse(`${d}T12:00:00Z`);
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }) : d;
};

export const legal = {
  /** false: show the "this is a template" banner. */
  configured: !!L,
  operator: L?.operator ?? '[Your organization]',
  email: L?.contactEmail ?? '[contact email]',
  address: L?.address ?? null,
  law: L?.governingLaw ?? null,
  effective: L ? long(L.effectiveDate) : '[effective date]',
};
/** Pack settings the notice depends on. */
export const siteName = config.name;
export const examName = config.exam;
export const hasGrade = (config.audience?.options.length ?? 0) > 0;
export const gradeLabel = config.audience?.label ?? 'Grade';
/** Children per parent account (the same number as MAX_CHILDREN in src/lib/server/account.ts). */
export const MAX_CHILDREN = 3;
