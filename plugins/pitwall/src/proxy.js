import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/** Bridges stdio to a shared pitwall daemon. Returns false, bridging nothing, when the daemon is unreachable. */
export async function runProxy(url, projectDir) {
  try { await fetch(url, { signal: AbortSignal.timeout(2000) }); } catch { return false; }
  const stdio = new StdioServerTransport();
  let init, replay, reconnecting;
  const connect = () => {
    const t = new StreamableHTTPClientTransport(new URL(url), {
      // Encoded because HTTP header values cannot carry arbitrary path characters.
      requestInit: { headers: { 'x-pitwall-project-dir': encodeURIComponent(projectDir) } },
    });
    // The client already has its initialize response, so the replayed one is swallowed.
    t.onmessage = msg => (replay && msg.id === replay.id ? replay.done(msg) : stdio.send(msg));
    t.onclose = () => close();
    return t;
  };
  let http = connect();
  // A restarted or expiring daemon forgets our session; start a new one and replay initialize.
  const reestablish = () => reconnecting ??= (async () => {
    const old = http;
    old.onclose = undefined;
    await old.close().catch(() => {});
    const t = connect();
    try {
      await t.start();
      const done = new Promise(resolve => { replay = { id: init.id, done: resolve }; });
      await t.send(init);
      await Promise.race([done, new Promise((_, reject) => setTimeout(() => reject(new Error('re-initialize timed out')), 5000).unref())]);
      await t.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      http = t;
    } catch (e) {
      t.onclose = undefined;
      await t.close().catch(() => {});
      throw e;
    } finally { replay = undefined; }
  })().finally(() => { reconnecting = undefined; });
  const forward = async msg => {
    const used = http;
    try { return await used.send(msg); } catch (e) {
      if (!init || msg.method === 'initialize') throw e;
      if (used === http) await reestablish();
      return http.send(msg);
    }
  };
  stdio.onmessage = msg => {
    if (msg.method === 'initialize') init = msg;
    forward(msg).catch(e => {
      console.error(`pitwall: shared server error: ${e.message}`);
      if (msg.id !== undefined && msg.method) stdio.send({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: e.message } });
    });
  };
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await http.terminateSession().catch(() => {});
    await http.close().catch(() => {});
    await stdio.close().catch(() => {});
    process.exit(0);
  };
  stdio.onclose = close;
  // The SDK's stdio transport ignores stdin ending; the open SSE stream would keep this process alive.
  process.stdin.on('end', close);
  await http.start();
  await stdio.start();
  return true;
}
