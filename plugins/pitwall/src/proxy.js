import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/** Bridges stdio to a shared pitwall daemon. Returns false, bridging nothing, when the daemon is unreachable. */
export async function runProxy(url, projectDir) {
  try { await fetch(url, { signal: AbortSignal.timeout(2000) }); } catch { return false; }
  const stdio = new StdioServerTransport();
  const http = new StreamableHTTPClientTransport(new URL(url), {
    // Encoded because HTTP header values cannot carry arbitrary path characters.
    requestInit: { headers: { 'x-pitwall-project-dir': encodeURIComponent(projectDir) } },
  });
  stdio.onmessage = msg => http.send(msg).catch(e => {
    console.error(`pitwall: shared server error: ${e.message}`);
    if (msg.id !== undefined && msg.method) stdio.send({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: e.message } });
  });
  http.onmessage = msg => stdio.send(msg);
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await http.terminateSession().catch(() => {});
    await http.close().catch(() => {});
    await stdio.close().catch(() => {});
    process.exit(0);
  };
  stdio.onclose = http.onclose = close;
  // The SDK's stdio transport ignores stdin ending; the open SSE stream would keep this process alive.
  process.stdin.on('end', close);
  await http.start();
  await stdio.start();
  return true;
}
