import { createMcpHandler } from '@modelcontextprotocol/server';
import { buildServer } from './index.mjs';
import { MAX_REQUEST_BYTES } from './http-core.mjs';
import { parseOAuthConfig, createTokenVerifier, protectedResourceMetadata, authChallenge } from './oauth.mjs';

const safeHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const reply = (status, message, headers = {}) => new Response(message, { status, headers: { ...safeHeaders, ...headers } });

export function createVercelApp({ env = process.env, verifier, handler } = {}) {
  let config;
  let verify;
  let mcp;
  return {
    async fetch(request) {
      try {
        const url = new URL(request.url);
        if (url.pathname === '/healthz' && request.method === 'GET' && !url.search) {
          return Response.json({ status: 'ok' }, { headers: safeHeaders });
        }
        const metadata = ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'].includes(url.pathname);
        if (!metadata && url.pathname !== '/mcp') return reply(404, 'Não encontrado.');
        config ??= parseOAuthConfig(env);
        if (url.origin !== new URL(config.publicUrl).origin) return reply(421, 'Host não autorizado.');
        if (url.search) return reply(400, 'Query não permitida.');
        // Este servidor é usado pelo cliente MCP remoto, sem chamadas de browsers de outras origens.
        const origin = request.headers.get('origin');
        if (origin && origin !== url.origin) return reply(403, 'Origin não autorizado.');
        if (metadata) {
          if (request.method !== 'GET') return reply(405, 'Método não permitido.', { Allow: 'GET' });
          return Response.json(protectedResourceMetadata(config), { headers: safeHeaders });
        }
        if (!['POST', 'GET', 'DELETE'].includes(request.method)) return reply(405, 'Método não permitido.', { Allow: 'GET, POST, DELETE' });
        const authorization = request.headers.get('authorization') ?? '';
        const match = authorization.length <= 16384 && /^Bearer ([A-Za-z0-9._~-]+)$/.exec(authorization);
        if (!match) return reply(401, 'Autenticação OAuth necessária.', { 'WWW-Authenticate': authChallenge(config) });
        verify ??= verifier ?? createTokenVerifier(config);
        let access;
        try { access = await verify(match[1]); }
        catch { return reply(401, 'Token inválido ou expirado.', { 'WWW-Authenticate': authChallenge(config, 'invalid_token') }); }
        if (access === 'forbidden') return reply(403, 'Acesso restrito ao proprietário.');
        if (access !== 'authorized') return reply(403, 'Escopo insuficiente.', { 'WWW-Authenticate': authChallenge(config, 'insufficient_scope') });
        let incoming = request;
        if (request.method === 'POST') {
          const length = request.headers.get('content-length');
          if (length && (!/^\d+$/.test(length) || Number(length) > MAX_REQUEST_BYTES)) return reply(413, 'Corpo excede 1 MiB.');
          const reader = request.body?.getReader();
          const chunks = [];
          let size = 0;
          if (reader) {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              size += value.byteLength;
              if (size > MAX_REQUEST_BYTES) { await reader.cancel(); return reply(413, 'Corpo excede 1 MiB.'); }
              chunks.push(value);
            }
          }
          incoming = new Request(request.url, { method: 'POST', headers: request.headers, body: Buffer.concat(chunks) });
        }
        mcp ??= handler ?? createMcpHandler(() => buildServer({ oauthScope: config.scope }), { legacy: 'stateless' });
        const response = await mcp.fetch(incoming);
        const headers = new Headers(response.headers);
        for (const [name, value] of Object.entries(safeHeaders)) headers.set(name, value);
        return new Response(response.body, { status: response.status, headers });
      } catch {
        return reply(503, 'Servidor temporariamente indisponível.');
      }
    },
  };
}
