import { createRemoteJWKSet, jwtVerify } from 'jose';

function httpsUrl(value, name) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} exige HTTPS sem credenciais, query ou fragmento.`);
  }
  return url;
}

export function parseOAuthConfig(env = process.env) {
  const publicUrl = httpsUrl(env.MCP_PUBLIC_URL, 'MCP_PUBLIC_URL');
  if (publicUrl.pathname !== '/mcp') throw new Error('MCP_PUBLIC_URL deve terminar em /mcp.');
  const issuer = httpsUrl(env.OAUTH_ISSUER, 'OAUTH_ISSUER');
  const jwksUrl = httpsUrl(env.OAUTH_JWKS_URL, 'OAUTH_JWKS_URL');
  if (issuer.origin !== jwksUrl.origin) throw new Error('JWKS deve pertencer ao emissor configurado.');
  const owner = env.OAUTH_OWNER_SUB?.trim();
  if (!owner) throw new Error('Configure OAUTH_OWNER_SUB para restringir o acesso ao proprietário.');
  return Object.freeze({
    publicUrl: publicUrl.href, issuer: issuer.href, jwksUrl, owner,
    scope: 'portal:read', metadataUrl: `${publicUrl.origin}/.well-known/oauth-protected-resource`,
  });
}

export function createTokenVerifier(config, key = createRemoteJWKSet(config.jwksUrl, { timeoutDuration: 5000 })) {
  return async token => {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ['RS256', 'ES256'], issuer: config.issuer, audience: config.publicUrl,
      requiredClaims: ['exp', 'iat', 'sub'], clockTolerance: 5,
    });
    if (payload.sub !== config.owner) return 'forbidden';
    if (typeof payload.scope !== 'string' || !payload.scope.split(' ').includes(config.scope)) return 'insufficient_scope';
    return 'authorized';
  };
}

export function protectedResourceMetadata(config) {
  return {
    resource: config.publicUrl, authorization_servers: [config.issuer],
    scopes_supported: [config.scope], bearer_methods_supported: ['header'],
    resource_name: 'Portal da Transparência BR',
  };
}

export function authChallenge(config, error) {
  return `Bearer resource_metadata="${config.metadataUrl}", scope="${config.scope}"${error ? `, error="${error}"` : ''}`;
}
