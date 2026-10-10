import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { buildServer } from '../server/index.mjs';
import { createRemoteServer, parseRemoteConfig } from '../server/http-core.mjs';

test('HTTP com SDK real: autenticação, handshake e três ferramentas', { timeout: 10000 }, async () => {
  const previousKey = process.env.TRANSPARENCIA_API_KEY;
  process.env.TRANSPARENCIA_API_KEY = '';
  const token = 'fixture-http-sdk-owner-token-0123456789';
  const config = { ...parseRemoteConfig({
    MCP_ACCESS_TOKEN: token, MCP_PUBLIC_URL: 'http://127.0.0.1:3000/mcp', PORT: '0',
  }) };
  const handler = createMcpHandler(buildServer, { legacy: 'stateless' });
  const server = createRemoteServer({ mcpHandler: handler, config });
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    config.publicUrl = new URL(`http://127.0.0.1:${server.address().port}/mcp`);
    let id = 0;
    async function call(method, params = {}) {
      const response = await fetch(config.publicUrl, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`, 'content-type': 'application/json',
          accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
        signal: AbortSignal.timeout(3000),
      });
      assert.equal(response.status, 200);
      const body = await response.text();
      const message = response.headers.get('content-type').includes('text/event-stream')
        ? JSON.parse(body.split(/\r?\n/).find(line => line.startsWith('data:')).slice(5))
        : JSON.parse(body);
      assert.equal(message.id, id);
      assert.equal(message.error, undefined);
      return message.result;
    }
    const denied = await fetch(config.publicUrl, { method: 'POST', body: '{}' });
    assert.equal(denied.status, 401);
    await denied.text();
    const init = await call('initialize', {
      protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'teste-http', version: '1.0' },
    });
    assert.equal(init.serverInfo.name, 'portal-transparencia-brasil');
    const list = await call('tools/list');
    assert.deepEqual(list.tools.map(tool => tool.name), ['portal_catalogo', 'portal_consultar', 'portal_status']);
    const catalog = await call('tools/call', { name: 'portal_catalogo', arguments: { limite: 250 } });
    assert.equal(catalog.isError, false);
    assert.equal(JSON.parse(catalog.content[0].text).operacoes.length, 109);
    const status = await call('tools/call', { name: 'portal_status', arguments: {} });
    assert.equal(JSON.parse(status.content[0].text).autenticacao_configurada, false);
    const missing = await call('tools/call', { name: 'portal_consultar', arguments: { operacao: 'orgaosSiafi' } });
    assert.equal(missing.isError, true);
    assert.match(missing.content[0].text, /Configure TRANSPARENCIA_API_KEY/);
  } finally {
    if (previousKey === undefined) delete process.env.TRANSPARENCIA_API_KEY;
    else process.env.TRANSPARENCIA_API_KEY = previousKey;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await handler.close();
  }
});
