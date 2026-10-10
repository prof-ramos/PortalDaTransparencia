import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT } from 'jose';
import { createTokenVerifier, parseOAuthConfig } from '../server/oauth.mjs';
import { createVercelApp } from '../server/vercel-app.mjs';

const env = {
  MCP_PUBLIC_URL: 'https://portal.example/mcp', OAUTH_ISSUER: 'https://tenant.example/',
  OAUTH_JWKS_URL: 'https://tenant.example/.well-known/jwks.json', OAUTH_OWNER_SUB: 'auth0|owner',
};

test('OAuth rejeita configuração incompleta ou insegura', () => {
  assert.throws(() => parseOAuthConfig({ ...env, OAUTH_OWNER_SUB: '' }));
  assert.throws(() => parseOAuthConfig({ ...env, OAUTH_ISSUER: 'http://tenant.example/' }));
  assert.throws(() => parseOAuthConfig({ ...env, OAUTH_JWKS_URL: 'https://outro.example/keys' }));
  assert.throws(() => parseOAuthConfig({ ...env, MCP_PUBLIC_URL: 'https://portal.example/other' }));
});

test('JWT real exige assinatura, emissor, audience, expiração, escopo e proprietário', async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const config = parseOAuthConfig(env);
  const verify = createTokenVerifier(config, publicKey);
  async function token(claims = {}, key = privateKey) {
    return new SignJWT({ sub: env.OAUTH_OWNER_SUB, scope: 'portal:read', ...claims })
      .setProtectedHeader({ alg: 'RS256' }).setIssuer(claims.iss ?? env.OAUTH_ISSUER)
      .setAudience(claims.aud ?? env.MCP_PUBLIC_URL).setIssuedAt()
      .setExpirationTime(claims.exp ?? '5m').sign(key);
  }
  assert.equal(await verify(await token()), 'authorized');
  assert.equal(await verify(await token({ sub: 'auth0|other' })), 'forbidden');
  assert.equal(await verify(await token({ scope: 'other:read' })), 'insufficient_scope');
  await assert.rejects(verify(await token({ iss: 'https://other.example/' })));
  await assert.rejects(verify(await token({ aud: 'https://other.example/mcp' })));
  await assert.rejects(verify(await token({ exp: Math.floor(Date.now() / 1000) - 60 })));
  const other = await generateKeyPair('RS256');
  await assert.rejects(verify(await token({}, other.privateKey)));
  const noExpiration = await new SignJWT({ sub: env.OAUTH_OWNER_SUB, scope: 'portal:read' })
    .setProtectedHeader({ alg: 'RS256' }).setIssuer(env.OAUTH_ISSUER)
    .setAudience(env.MCP_PUBLIC_URL).setIssuedAt().sign(privateKey);
  await assert.rejects(verify(noExpiration));
});

test('Vercel publica descoberta, falha fechada e protege o SDK real', async () => {
  const app = createVercelApp({ env, verifier: async token => {
    if (token === 'invalid') throw new Error('segredo de teste');
    return token === 'owner' ? 'authorized' : token === 'other' ? 'forbidden' : 'insufficient_scope';
  } });
  const request = (path, token, body) => new Request(`https://portal.example${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}),
      accept: 'application/json, text/event-stream', 'content-type': 'application/json',
      'mcp-protocol-version': '2025-06-18' }, body,
  });
  const metadata = await app.fetch(request('/.well-known/oauth-protected-resource'));
  assert.equal(metadata.status, 200);
  assert.deepEqual(await metadata.json(), {
    resource: env.MCP_PUBLIC_URL, authorization_servers: [env.OAUTH_ISSUER],
    scopes_supported: ['portal:read'], bearer_methods_supported: ['header'], resource_name: 'Portal da Transparência BR',
  });
  const anonymous = await app.fetch(request('/mcp'));
  assert.equal(anonymous.status, 401);
  assert.match(anonymous.headers.get('www-authenticate'), /resource_metadata=/);
  assert.equal((await app.fetch(request('/mcp', 'other'))).status, 403);
  assert.equal((await app.fetch(request('/mcp', 'scope'))).status, 403);
  const invalid = await app.fetch(request('/mcp', 'invalid'));
  assert.equal(invalid.status, 401);
  assert.doesNotMatch(await invalid.text(), /segredo/);
  assert.equal((await app.fetch(request('/mcp', 'owner', 'x'.repeat(1024 * 1024 + 1)))).status, 413);
  assert.equal((await app.fetch(new Request('https://evil.example/mcp'))).status, 421);
  assert.equal((await createVercelApp({ env: {} }).fetch(request('/mcp'))).status, 503);
  const result = await app.fetch(request('/mcp', 'owner', JSON.stringify({ jsonrpc:'2.0', id:1, method:'tools/list', params:{} })));
  assert.equal(result.status, 200);
  const body = await result.text();
  const message = result.headers.get('content-type').includes('text/event-stream')
    ? JSON.parse(body.split(/\r?\n/).find(line => line.startsWith('data:')).slice(5)) : JSON.parse(body);
  assert.deepEqual(message.result.tools.map(tool => tool.name), ['portal_catalogo', 'portal_consultar', 'portal_status']);
  assert.deepEqual(message.result.tools[0]._meta.securitySchemes, [{ type:'oauth2', scopes:['portal:read'] }]);
});
