import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

/** Serves MCP over Streamable HTTP on loopback only, one McpServer per session. Port 0 picks a free one. */
export function serveHttp(shared, createSessionServer, port) {
  const sessions = new Map();
  const lastSeen = new Map();
  const idleMs = Number(process.env.PITWALL_SESSION_IDLE_MS) || 3600000;
  // A killed proxy never sends DELETE, so idle sessions are dropped; live proxies re-establish on their next call.
  const sweep = setInterval(() => {
    for (const [id, t] of sessions) if (Date.now() - lastSeen.get(id) > idleMs) { console.error(`pitwall: session ${id} expired`); t.close(); }
  }, Math.min(idleMs / 2, 60000)).unref();
  const maxRss = Number(process.env.PITWALL_MAX_RSS_MB) * 1048576;
  // Exits so a supervisor (launchd, systemd) restarts it; proxies reconnect on their next call.
  // ponytail: resident memory only, compressed or swapped pages are not counted.
  if (maxRss) setInterval(() => {
    if (process.memoryUsage.rss() > maxRss) { console.error(`pitwall: over PITWALL_MAX_RSS_MB, exiting`); process.exit(1); }
  }, 30000).unref();
  const send = (res, code, message) => res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }));
  const httpServer = http.createServer(async (req, res) => {
    try {
      if (new URL(req.url, 'http://x').pathname !== '/mcp') return send(res, 404, 'Not found');
      const sid = req.headers['mcp-session-id'];
      let transport = sid && sessions.get(sid);
      if (transport) lastSeen.set(sid, Date.now());
      if (!transport) {
        if (sid) return send(res, 404, 'Unknown session');
        if (req.method !== 'POST') return send(res, 400, 'Missing Mcp-Session-Id');
        const { port: p } = httpServer.address();
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: randomUUID,
          onsessioninitialized: id => { sessions.set(id, transport); lastSeen.set(id, Date.now()); },
          enableDnsRebindingProtection: true,
          allowedHosts: [`127.0.0.1:${p}`, `localhost:${p}`],
          allowedOrigins: [`http://127.0.0.1:${p}`, `http://localhost:${p}`],
        });
        const t = transport;
        t.onclose = () => { if (t.sessionId) { sessions.delete(t.sessionId); lastSeen.delete(t.sessionId); } };
        const dir = req.headers['x-pitwall-project-dir'];
        await createSessionServer(shared, { projectDir: dir && decodeURIComponent(dir) }).connect(t);
      }
      await transport.handleRequest(req, res);
    } catch (e) {
      console.error(`pitwall: request failed: ${e.message}`);
      if (!res.headersSent) send(res, 500, 'Internal error');
    }
  });
  httpServer.on('close', () => clearInterval(sweep));
  return new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, '127.0.0.1', () => {
      console.error(`pitwall: listening on http://127.0.0.1:${httpServer.address().port}/mcp`);
      resolve(httpServer);
    });
  });
}
