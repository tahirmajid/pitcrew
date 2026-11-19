import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { FIXTURE, tmp } from './helpers.mjs';

const INDEX = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.js');
const base = fs.realpathSync(tmp());
fs.cpSync(FIXTURE, base, { recursive: true });
const dirA = fs.realpathSync(tmp()), dirB = fs.realpathSync(tmp());
const env = extra => ({ ...process.env, PITWALL_BASE_DIR: base, PITWALL_DB_PATH: path.join(tmp(), 's.db'), ...extra });

const daemon = spawn(process.execPath, [INDEX], { env: env({ PITWALL_HTTP_PORT: '0' }), stdio: ['ignore', 'ignore', 'pipe'] });
const url = await new Promise((resolve, reject) => {
  let err = '';
  daemon.stderr.on('data', d => { err += d; const m = err.match(/listening on (http:\/\/\S+)/); if (m) resolve(m[1]); });
  daemon.once('exit', () => reject(new Error(`daemon exited: ${err}`)));
});

const clients = [];
async function connect(extra) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [INDEX], env: env(extra), stderr: 'pipe' });
  let stderr = '';
  transport.stderr.on('data', d => { stderr += d; });
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(transport);
  clients.push(client);
  return { client, stderr: () => stderr, call: async (name, args = {}) => (await client.callTool({ name, arguments: args })).content[0].text };
}
after(async () => { for (const c of clients) await c.close(); daemon.kill(); });

test('two proxies share one daemon and keep their own project dir', async () => {
  const a = await connect({ PITWALL_URL: url, PITWALL_PROJECT_DIR: dirA });
  const b = await connect({ PITWALL_URL: url, PITWALL_PROJECT_DIR: dirB });
  for (const p of [a, b]) {
    assert.ok((await p.client.listTools()).tools.some(t => t.name === 'recall'));
    assert.match(await p.call('list_directory'), /retry-policy\.md/);
  }
  await a.call('link_project', { project: 'orbit', repo: dirA, tier: 'medium' });
  assert.match(await a.call('list_projects'), /\*.*orbit|orbit.*\*/);
  assert.doesNotMatch(await b.call('list_projects'), /\*/);
});

test('an unreachable daemon falls back to running in-process', async () => {
  const p = await connect({ PITWALL_URL: 'http://127.0.0.1:1/mcp' });
  assert.match(await p.call('list_directory'), /retry-policy\.md/);
  assert.match(p.stderr(), /pitwall: shared server at http:\/\/127\.0\.0\.1:1\/mcp unreachable, running in-process/);
});

test('a foreign Host header is rejected', async () => {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'x', version: '1' } } });
  // fetch cannot override Host, so use node:http.
  const status = await new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject).end(body);
  });
  assert.equal(status, 403);
});
