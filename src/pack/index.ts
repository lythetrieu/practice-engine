// The chosen test pack, for the app and the server. Everything exam-specific the engine shows comes from here.
import data from 'virtual:pack';
import type { Pack, PackSection } from './types';

export const pack = data as Pack;
export const config = pack.config;
export const SECTIONS: PackSection[] = config.sections;
export const SECTION_IDS: string[] = SECTIONS.map((s) => s.id);
const BY_ID = Object.fromEntries(SECTIONS.map((s) => [s.id, s]));
/** "Mathematics" */
export const sectionName = (id: string) => BY_ID[id]?.name ?? id;
/** "Math" (the short name, or the name) */
export const sectionShort = (id: string) => BY_ID[id]?.short ?? BY_ID[id]?.name ?? id;
export const isSection = (id: unknown): id is string => typeof id === 'string' && id in BY_ID;
export const skillName = (id: string) => pack.skills[id]?.name ?? id;

/** The brand colors as the app's CSS variables (set on .pa and on site pages). */
export function brandVars(): Record<string, string> {
  const c = config.brand.colors;
  return {
    '--primary': c.primary,
    '--primary-edge': c.primaryDark ?? c.primary,
    '--accent': c.accent,
    '--reward': c.reward ?? '#E3A72F',
    '--bg': c.background ?? '#FBF8F3',
    '--frame': c.frame ?? '#E6EFE1',
  };
}
export const brandStyle = () => Object.entries(brandVars()).map(([k, v]) => `${k}:${v}`).join(';');

/** The mascot's name ("Pip" unless the pack names its own). */
export const mascotName = config.mascot?.name || 'Pip';
