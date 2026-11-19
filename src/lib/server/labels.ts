/* Fixed lists of reasons and screens for problem reports (api/report.ts). Children only tap one of these;
   nothing they type is ever stored. */
export const REASONS = ['wrong_key', 'unclear', 'explanation', 'typo', 'display', 'other'];
// Problems with the practice app itself (context 'issue'): reason codes and the screens a student can pick.
export const ISSUE_REASONS = ['broken', 'looks_wrong', 'slow', 'sound', 'progress', 'other'];
export const ISSUE_SCREENS = ['home', 'learn', 'lesson', 'complete', 'review', 'test', 'me', 'other'];
