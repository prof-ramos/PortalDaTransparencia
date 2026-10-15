import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { queryPortal, QUERY_TIMEOUT_MS } from '../server/portal.mjs';

async function upstream(t, handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return (url, options) => fetch(`${base}${url.pathname}${url.search}`, options);
}

const args = { operacao: 'orgaosSiafi', max_paginas: 5, limite_registros: 50 };

test('prazo global cancela paginação com fetch HTTP real', { timeout: 5000 }, async t => {
  let calls = 0;
  let cancelled = false;
  let resolveCancellation;
  const cancellation = new Promise(resolve => { resolveCancellation = resolve; });
  const fetchFn = await upstream(t, (req, res) => {
    calls++;
    const timer = setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('[{"codigo":"1"}]');
    }, calls === 1 ? 0 : 10000);
    res.on('close', () => { clearTimeout(timer); if (!res.writableEnded) { cancelled = true; resolveCancellation(); } });
  });
  await assert.rejects(queryPortal(args, { apiKey: 'fake', fetchFn, pace: false, timeoutMs: 2000 }), /Prazo total/);
  assert.equal(calls, 2);
  // Aguarda o evento de fechamento da conexão abortada no upstream.
  await cancellation;
  assert.equal(cancelled, true);
});

test('prazo global interrompe Retry-After sem fazer nova tentativa', async t => {
  let calls = 0;
  const fetchFn = await upstream(t, (_req, res) => {
    calls++;
    res.writeHead(429, { 'retry-after': '10' });
    res.end();
  });
  await assert.rejects(queryPortal(args, { apiKey: 'fake', fetchFn, pace: false, timeoutMs: 150 }), /Prazo total/);
  assert.equal(calls, 1);
});

test('prazo global também cancela leitura do corpo HTTP', async t => {
  const fetchFn = await upstream(t, (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('[');
  });
  await assert.rejects(queryPortal(args, { apiKey: 'fake', fetchFn, pace: false, timeoutMs: 150 }), /Prazo total/);
});

test('prazo não pode exceder o orçamento de produção', async () => {
  assert.equal(QUERY_TIMEOUT_MS, 45000);
  await assert.rejects(queryPortal(args, { timeoutMs: 60000 }), /Prazo da consulta inválido/);
});


test('prazo global cancela consulta ainda aguardando sua vez na fila', { timeout: 5000 }, async () => {
  let calls = 0;
  const fetchFn = async () => { calls++; return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }); };
  const request = { operacao: 'orgaosSiafi' };
  await queryPortal(request, { apiKey: 'fake', fetchFn, timeoutMs: 3000 });
  const queued = queryPortal(request, { apiKey: 'fake', fetchFn, timeoutMs: 3000 });
  let callsAtDeadline;
  try {
    await assert.rejects(queryPortal(request, { apiKey: 'fake', fetchFn, timeoutMs: 50 }), /Prazo total/);
    callsAtDeadline = calls;
  } finally {
    await queued;
  }
  assert.equal(callsAtDeadline, 1, 'o prazo deve vencer antes de a consulta anterior sair da fila');
  assert.equal(calls, 2, 'a consulta não vencida deve continuar normalmente');
});
