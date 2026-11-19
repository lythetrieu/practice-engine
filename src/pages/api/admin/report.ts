import { adminNotFound, adminPost, setReportsResolved } from '../../../lib/server/admin';
import { db } from '../../../lib/server/env';
import { HttpError, int, str } from '../../../lib/server/http';

export const prerender = false;

/**
 * Resolve or reopen problem reports. POST only; an admin with a fresh session only (anyone else gets a 404).
 * Body: {resolved: true|false} and either {id} (one report) or {item} (every report on one question).
 */
export const POST = adminPost(async ({ body }) => {
  if (typeof body.resolved !== 'boolean') throw new HttpError(400, 'Say whether to resolve or reopen.');
  const target = body.item != null
    ? { item: str(body.item, 'question id', 80, { pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/ }) }
    : { id: int(body.id, 'report', 1, Number.MAX_SAFE_INTEGER) as number };
  const changed = await setReportsResolved(db(), target, body.resolved);
  return { changed, resolved: body.resolved };
});

export const ALL = adminNotFound;
