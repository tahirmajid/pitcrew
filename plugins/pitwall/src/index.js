#!/usr/bin/env node
import { envVal } from './config.js';

const url = envVal(process.env, 'PITWALL_URL');
const port = envVal(process.env, 'PITWALL_HTTP_PORT');

// Proxy mode must not load the heavy modules, so everything below is a dynamic import.
const proxied = url && await (await import('./proxy.js')).runProxy(url, process.env.PITWALL_PROJECT_DIR || process.env.CLAUDE_PROJECT_DIR || process.cwd());
if (url && !proxied) console.error(`pitwall: shared server at ${url} unreachable, running in-process`);

if (!proxied) {
  const { buildShared, createSessionServer } = await import('./server.js');
  const shared = buildShared();
  const reconcile = () => shared.indexer.reconcile().catch(e => console.error(`pitwall: reconcile failed: ${e.message}`));
  if (port) {
    await (await import('./http.js')).serveHttp(shared, createSessionServer, Number(port));
  } else {
    const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
    await createSessionServer(shared, { projectDir: shared.cfg.projectDir || process.env.CLAUDE_PROJECT_DIR }).connect(new StdioServerTransport());
  }
  reconcile();
}
