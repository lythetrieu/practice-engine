#!/usr/bin/env node
// The engine's command line: pick a pack, check it, and run Astro with it.
//   node scripts/pack.mjs validate [--pack <name|path>] [--all]
//   node scripts/pack.mjs dev      [--pack <name|path>] [astro dev options]
//   node scripts/pack.mjs build    [--pack <name|path>]
// The pack is --pack, else the PACK environment variable, else "shsat-sample". `npm run dev -- --pack demo-isee`
// passes the flag through npm. A build reads only the pack's files: no database, local or remote.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatProblems, listPacks, loadPack, packDir } from '../src/pack/load.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_PACK = 'shsat-sample';

const [cmd = 'help', ...rest] = process.argv.slice(2);
const args = [];
let pack = process.env.PACK || DEFAULT_PACK;
let all = false;
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (a === '--pack' || a === '-p') pack = rest[++i];
  else if (a.startsWith('--pack=')) pack = a.slice(7);
  else if (a === '--all') all = true;
  else if (cmd === 'validate' && !a.startsWith('-')) pack = a;
  else args.push(a);
}

/** Checks one pack and prints the result. Returns true when it has no errors. */
function check(nameOrPath, { quiet = false } = {}) {
  const dir = packDir(ROOT, nameOrPath);
  if (!existsSync(dir)) {
    console.error(`✗ No pack "${nameOrPath}". Packs here: ${listPacks(ROOT).join(', ') || '(none)'}`);
    return false;
  }
  const r = loadPack(dir);
  const name = path.relative(ROOT, dir) || dir;
  if (r.warnings.length && !quiet) console.warn(`${name}: ${r.warnings.length} warning(s)\n${formatProblems(r.warnings, 'warning')}`);
  if (!r.ok) {
    console.error(`✗ ${name}: ${r.errors.length} problem(s)\n${formatProblems(r.errors)}`);
    return false;
  }
  const s = r.stats;
  console.log(`✓ ${name}: ${r.pack.config.name} — ${s.questions} questions, ${s.passages} passages, ${s.worlds} worlds, ${s.lessons} lessons`);
  return true;
}

function run(bin, binArgs, env) {
  const exe = bin === 'node' ? process.execPath : path.join(ROOT, 'node_modules', '.bin', bin);
  const child = spawn(exe, binArgs, { stdio: 'inherit', env: { ...process.env, ...env }, cwd: ROOT });
  child.on('exit', (code) => process.exit(code ?? 1));
}

switch (cmd) {
  case 'validate': {
    const names = all ? listPacks(ROOT) : [pack];
    const ok = names.map((n) => check(n)).every(Boolean);
    process.exit(ok ? 0 : 1);
    break;
  }
  case 'dev':
  case 'build':
  case 'preview': {
    if (!check(pack, { quiet: cmd !== 'dev' })) process.exit(1);
    const dir = packDir(ROOT, pack);
    console.log(`Pack: ${path.relative(ROOT, dir)}`);
    if (cmd === 'build') {
      const child = spawn(path.join(ROOT, 'node_modules', '.bin', 'astro'), ['build', ...args], { stdio: 'inherit', env: { ...process.env, PACK: dir }, cwd: ROOT });
      child.on('exit', (code) => {
        if (code) process.exit(code);
        run('node', [path.join(ROOT, 'scripts', 'build-sw.mjs')], { PACK: dir });
      });
    } else run('astro', [cmd, ...args], { PACK: dir });
    break;
  }
  default:
    console.log(`Usage:
  npm run validate -- [--pack <name|path>] [--all]   check a pack (exit 1 on problems)
  npm run dev -- [--pack <name|path>]                run the app with a pack (default: ${DEFAULT_PACK})
  npm run build -- [--pack <name|path>]              build for Cloudflare Workers
Packs: ${listPacks(ROOT).join(', ') || '(none)'}`);
}
