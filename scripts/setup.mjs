#!/usr/bin/env node
// First-time setup for local development, in one command (npm run setup):
// 1. makes .dev.vars from .dev.vars.example with a fresh random PASSWORD_PEPPER (an existing .dev.vars is kept);
// 2. creates the local database tables (wrangler d1 migrations apply DB --local).
// Nothing here touches a Cloudflare account: the database is a local file under .wrangler/.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vars = path.join(ROOT, '.dev.vars');

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
  console.error(`✗ Node ${process.versions.node} is too old. Install Node 22.12 or newer from https://nodejs.org and run this again.`);
  process.exit(1);
}

if (existsSync(vars)) console.log('✓ .dev.vars already exists (kept as it is)');
else {
  const example = readFileSync(path.join(ROOT, '.dev.vars.example'), 'utf8');
  writeFileSync(vars, example.replace(/^PASSWORD_PEPPER=.*$/m, `PASSWORD_PEPPER=${randomBytes(32).toString('base64url')}`)
    .replace(/^OPENROUTER_API_KEY=.*$/m, 'OPENROUTER_API_KEY='));
  console.log('✓ made .dev.vars with a new random PASSWORD_PEPPER');
}

const bin = path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler');
if (!existsSync(bin)) { console.error('✗ Run npm install first.'); process.exit(1); }
const r = spawnSync(bin, ['d1', 'migrations', 'apply', 'DB', '--local'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
if (r.status !== 0) { console.error('✗ Could not create the local database tables (see the message above).'); process.exit(r.status ?? 1); }
console.log('\n✓ Ready. Start the app with:  npm run dev\n  then open http://localhost:4321/app/');
