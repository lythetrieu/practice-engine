// The Vite plugin that hands the chosen pack to the app: `import pack from 'virtual:pack'` (config, branding, map)
// and `import('virtual:pack-bank')` (questions, passages, teaching steps; its own chunk, loaded after the first screen).
// Under `astro dev` it watches the pack folder: an edit reloads the app, and a broken edit shows the problems
// in the terminal and the browser overlay while the last good copy keeps running.
import path from 'node:path';
import { formatProblems, loadPack } from './load.mjs';

const IDS = { 'virtual:pack': 'pack', 'virtual:pack-bank': 'bank' };

export function packPlugin(dir, first) {
  let current = first;
  return {
    name: 'practice-engine:pack',
    resolveId(id) { return id in IDS ? '\0' + id : undefined; },
    load(id) {
      if (!id.startsWith('\0virtual:pack')) return undefined;
      const which = IDS[id.slice(1)];
      return `export default ${JSON.stringify(current[which])};`;
    },
    configureServer(server) {
      server.watcher.add(dir);
      const onChange = (file) => {
        if (!path.resolve(file).startsWith(dir + path.sep)) return;
        const next = loadPack(dir);
        if (!next.ok) {
          const msg = `The pack has problems (the app keeps the last good copy):\n${formatProblems(next.errors)}`;
          server.config.logger.error(msg);
          server.ws.send({ type: 'error', err: { message: msg, stack: '' } });
          return;
        }
        current = next;
        for (const id of Object.keys(IDS)) {
          const mod = server.moduleGraph.getModuleById('\0' + id);
          if (mod) server.moduleGraph.invalidateModule(mod);
        }
        server.config.logger.info(`pack reloaded: ${next.stats.questions} questions, ${next.stats.lessons} lessons`);
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('change', onChange);
      server.watcher.on('add', onChange);
      server.watcher.on('unlink', onChange);
    },
  };
}
