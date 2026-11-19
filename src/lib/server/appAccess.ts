/* Who may open the practice app: a signed-in parent (their children play through "Who's practicing?") or a
   signed-in student. A visitor with no account is sent to /account/ to create one. Used by the /app/ page
   (src/worker.ts). */
import { currentUser } from './auth';
import { currentStudent } from './student';

export async function appMember(request: Request): Promise<'parent' | 'student' | null> {
  if (await currentStudent(request)) return 'student';
  if (await currentUser(request)) return 'parent';
  return null;
}

/** Where a visitor without an account goes: the account page, which brings them back to the app. */
export const APP_SIGN_IN = '/account/?next=app';
