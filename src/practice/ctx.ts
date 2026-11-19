// What every screen can read and do. PracticeApp.tsx provides it.
import { createContext, useContext } from 'react';
import type { Progress, Finish, Report } from './store';
import type { Sfx } from './fx';
import type { Kid } from './family';

// Hash routes: #home, #learn (or #learn/<subject>/<world>), #review, #test, #me,
// #play/<lesson id | unit check id | review>, #done (the lesson-complete screen),
// #level[/<lesson id>] (dev only: any lesson, unsaved), #exam (the full test running), #exam/result/<test id>,
// #thanks (parents only: back from the paid plan's checkout, screens/ThankYou.tsx).
export type Tab = 'home' | 'learn' | 'review' | 'progress' | 'test' | 'me';
export interface Route { name: Tab | 'play' | 'done' | 'level' | 'start' | 'exam' | 'thanks'; args: string[] }

// Who is practicing: a signed-in student, a child picked on a parent's device ("Who's practicing?",
// family.ts), or a guest. name and grade are the student's or the picked child's.
export interface Me {
  role: 'student' | 'parent' | null;
  name: string | null;
  grade: number | null;
  /** Parent only: the children the parent can switch between here ([] = none yet), or null (not a parent,
      or the profile switcher is not available). */
  kids?: Kid[] | null;
  /** Parent only: the child practicing now, or null when the parent is just looking around. */
  as?: string | null;
  /** Parent only: no usable answer from /api/me/ (no connection, no answer yet, or a server error such as a
      429 from the rate limit or a 5xx), so the children on the account are not known here. The device keeps
      the child it was practicing as (profiles.ts profile: name and as), Switch is off (Me says why: no
      connection, or not available right now), and the app asks again (PracticeApp). Cleared by the next
      answer. */
  kidsUnknown?: boolean;
  /** Student only: whether this child has the paid plan (pack.yaml `plan`, /api/me/ plan.pro). A parent's children carry
      it in kids[i].pro. Only the free limits look at it (limits.ts), and only while payments are on. */
  pro?: boolean;
  /** Student only: the end date of that plan (YYYY-MM-DD…), null without a date. */
  proUntil?: string | null;
  /** Student only: the login name the parent made (shown in Settings > Account). */
  username?: string | null;
  /** Parent only: the email the account signs in with (shown in Settings > Account). */
  email?: string | null;
}

export interface AppCtx {
  p: Progress;
  /** Change progress (saved right away). Badges earned by the change are announced by the shell. */
  update: (fn: (p: Progress) => Progress) => void;
  route: Route;
  go: (hash: string) => void;
  sfx: (kind: Sfx) => void;           // silent when sound is off in Settings
  buzz: (ms: number | number[]) => void;
  motion: boolean;                    // false when motion is off in Settings or the OS asks for reduced motion
  me: Me;
  toast: (text: string, badgeId?: string) => void;
  /** Lesson / unit check / review round finished: scores it, saves it, shows the lesson-complete screen. */
  finishPlay: (f: Finish) => void;
  last: { f: Finish; r: Report } | null; // what the lesson-complete screen shows
  /** Opens "Who's practicing?" again (Me > Switch). Only for a parent's session with children. */
  switchWho: () => void;
}

export const Ctx = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp outside PracticeApp');
  return c;
}
