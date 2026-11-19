import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

/** Serves MCP over Streamable HTTP on loopback only, one McpServer per session. Port 0 picks a free one. */
export function serveHttp(shared, createSessionServer, port) {
  const sessions = new Map();
  const send = (res, code, message) => res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }));
  const httpServer = http.createServer(async (req, res) => {
    try {
      if (new URL(req.url, 'http://x').pathname !== '/mcp') return send(res, 404, 'Not found');
      const sid = req.headers['mcp-session-id'];
      let transport = sid && sessions.get(sid);
      if (!transport) {
        if (sid) return send(res, 404, 'Unknown session');
        if (req.method !== 'POST') return send(res, 400, 'Missing Mcp-Session-Id');
        const { port: p } = httpServer.address();
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: randomUUID,
          onsessioninitialized: id => sessions.set(id, transport),
          enableDnsRebindingProtection: true,
          allowedHosts: [`127.0.0.1:${p}`, `localhost:${p}`],
          allowedOrigins: [`http://127.0.0.1:${p}`, `http://localhost:${p}`],
        });
        const t = transport;
        t.onclose = () => { if (t.sessionId) sessions.delete(t.sessionId); };
        const dir = req.headers['x-pitwall-project-dir'];
        await createSessionServer(shared, { projectDir: dir && decodeURIComponent(dir) }).connect(t);
      }
      await transport.handleRequest(req, res);
    } catch (e) {
      console.error(`pitwall: request failed: ${e.message}`);
      if (!res.headersSent) send(res, 500, 'Internal error');
    }
  });
  return new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, '127.0.0.1', () => {
      console.error(`pitwall: listening on http://127.0.0.1:${httpServer.address().port}/mcp`);
      resolve(httpServer);
    });
  });
}
