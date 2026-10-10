/**
 * Adaptador HTTP privado para MCP. Apenas a camada de borda é implementada aqui;
 * o parsing/negociação do protocolo fica no SDK oficial MCP v2.
 * Sem dependências npm para permitir testes de segurança isolados.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const MAX_REQUEST_BYTES = 1024 * 1024;
const METHODS = new Set(['GET', 'POST', 'DELETE', 'OPTIONS']);
const RESPONSE_HEADERS = { 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer' };

export function parseRemoteConfig(env = process.env) {
  const accessToken = env.MCP_ACCESS_TOKEN ?? '';
  if (typeof accessToken !== 'string' || !/^[A-Za-z0-9_~+.\/-]{32,1024}={0,2}$/.test(accessToken)) {
    throw new Error('Configure MCP_ACCESS_TOKEN com pelo menos 32 caracteres não brancos (máximo 1024).');
  }
  let publicUrl;
  try { publicUrl = new URL(env.MCP_PUBLIC_URL || 'http://127.0.0.1:3000/mcp'); }
  catch { throw new Error('MCP_PUBLIC_URL não é uma URL válida.'); }
  if (publicUrl.pathname !== '/mcp' || publicUrl.search || publicUrl.hash || publicUrl.username || publicUrl.password) {
    throw new Error('MCP_PUBLIC_URL deve terminar em /mcp, sem query, fragmento ou credenciais.');
  }
  const local = ['localhost','127.0.0.1','[::1]'].includes(publicUrl.hostname);
  if (!local && publicUrl.protocol !== 'https:') throw new Error('MCP_PUBLIC_URL público exige HTTPS.');
  if (!['http:', 'https:'].includes(publicUrl.protocol)) throw new Error('MCP_PUBLIC_URL exige HTTP(S).');
  const rawOrigins=(env.MCP_ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean);
  const allowedOrigins=new Set();
  for (const input of rawOrigins) {
    let url;
    try { url=new URL(input); } catch { throw new Error('MCP_ALLOWED_ORIGINS contém URL inválida.'); }
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('MCP_ALLOWED_ORIGINS aceita apenas origens HTTP(S), sem caminhos.');
    }
    if (url.protocol!=='https:' && !['localhost','127.0.0.1','[::1]'].includes(url.hostname)) {
      throw new Error('Origens externas devem usar HTTPS.');
    }
    allowedOrigins.add(url.origin);
  }
  const rawPort=env.PORT ?? env.MCP_PORT ?? (publicUrl.port || '3000');
  const port=Number(rawPort);
  if (!Number.isInteger(port) || port<0 || port>65535) throw new Error('PORT fora do intervalo 0..65535.');
  const host=env.HOST || env.MCP_HOST || '127.0.0.1';
  if (typeof host !== 'string' || !/^[a-zA-Z0-9.:-]{1,128}$/.test(host)) throw new Error('HOST inválido.');
  if (local && !['127.0.0.1','localhost','::1'].includes(host)) {
    throw new Error('MCP_PUBLIC_URL local não pode escutar em interface de rede pública.');
  }
  return Object.freeze({accessToken, publicUrl, allowedOrigins, port, host});
}

function deny(code, message, extra={}) {
  return new Response(message+'\n', {status:code,headers:{...RESPONSE_HEADERS,'Content-Type':'text/plain; charset=utf-8',...extra}});
}

function authorized(value, token) {
  if (typeof value!=='string' || value.length > 2048) return false;
  const matched=/^Bearer ([A-Za-z0-9_~+.\/-]+=*)$/.exec(value);
  if (!matched) return false;
  const left=createHash('sha256').update(matched[1]).digest();
  const right=createHash('sha256').update(token).digest();
  return timingSafeEqual(left,right);
}

export function guardHttpRequest(request,config) {
  const url=new URL(request.url);
  if (url.host !== config.publicUrl.host) return deny(421,'Host não autorizado.');
  const origin=request.headers.get('origin');
  if (origin && !config.allowedOrigins.has(origin)) return deny(403,'Origin não autorizado.');
  if (origin==='null') return deny(403,'Origin não autorizado.');
  if (!METHODS.has(request.method)) return deny(405,'Método não permitido.',{'Allow':'GET, POST, DELETE, OPTIONS'});
  if (request.method==='OPTIONS') {
    if (!origin) return deny(400,'Origin exigido no preflight.');
    return new Response(null,{status:204,headers:{...RESPONSE_HEADERS,
      'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers':'Authorization, Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id, MCP-Method, MCP-Name, Last-Event-ID',
      'Access-Control-Max-Age':'300', 'Vary':'Origin',
    }});
  }
  if (url.pathname === '/healthz' && request.method === 'GET' && !url.search) {
    return Response.json({status:'ok'},{headers:RESPONSE_HEADERS});
  }
  if (url.pathname !== '/mcp' || url.search) return deny(404,'Não encontrado.');
  if (!authorized(request.headers.get('authorization'),config.accessToken)) {
    return deny(401,'Credencial de acesso MCP necessária.',{'WWW-Authenticate':'Bearer realm="Portal da Transparencia"'});
  }
  if (request.method==='POST') {
    const contentLength=request.headers.get('content-length');
    if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength)>MAX_REQUEST_BYTES)) {
      return deny(413,'Corpo de requisição excede 1 MiB.');
    }
  }
  return null;
}

function fromNodeRequest(req, config, body) {
  // A origem pública é fixa e validada, nunca construída a partir de Host/X-Forwarded-Host do cliente.
  const headers=new Headers();
  for (const [name,value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(name,Array.isArray(value)?value.join(', '):String(value));
  }
  const url=new URL(req.url||'/', config.publicUrl.origin);
  return new Request(url, {method:req.method,headers,
    ...(body!==undefined ? {body}:{}),
  });
}

async function readLimited(req) {
  const chunks=[];
  let count=0;
  for await (const chunk of req) {
    count+=chunk.byteLength;
    if (count>MAX_REQUEST_BYTES) {
      throw Object.assign(new Error('Payload muito grande.'),{code:413});
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function sendNodeResponse(res,response,origin,allowedOrigins) {
  const normalizedHeaders=new Headers(response.headers);
  for (const [name,value] of Object.entries(RESPONSE_HEADERS)) normalizedHeaders.set(name,value);
  if (origin && allowedOrigins.has(origin)) {
    normalizedHeaders.set('Access-Control-Allow-Origin',origin);
    normalizedHeaders.set('Access-Control-Expose-Headers','MCP-Session-Id, MCP-Protocol-Version, WWW-Authenticate');
    normalizedHeaders.set('Vary','Origin');
  }
  res.writeHead(response.status, Object.fromEntries(normalizedHeaders));
  if (response.body) await pipeline(Readable.fromWeb(response.body),res);
  else res.end();
}

/**
 * mcpHandler.fetch deve ser um handler do SDK (createMcpHandler).
 * Injeção deliberada para permitir testes da camada de proteção sem emular o SDK.
 */
export function createRemoteServer({mcpHandler, config}) {
  if (!mcpHandler || typeof mcpHandler.fetch!=='function') throw new Error('Handler MCP indisponível.');
  return createServer(async (req,res) => {
    const origin=req.headers.origin;
    try {
      if ((req.headers.host || '').toLowerCase() !== config.publicUrl.host.toLowerCase()) {
        return await sendNodeResponse(res,deny(421,'Host não autorizado.'),origin,config.allowedOrigins);
      }
      const initial=fromNodeRequest(req,config);
      const blocked=guardHttpRequest(initial,config);
      if (blocked) return await sendNodeResponse(res,blocked,origin,config.allowedOrigins);
      const payload=req.method==='POST' ? await readLimited(req) : undefined;
      const request=fromNodeRequest(req,config,payload);
      const response=await mcpHandler.fetch(request);
      await sendNodeResponse(res,response,origin,config.allowedOrigins);
    } catch (error) {
      // Erros MCP/HTTP e informações de requisição não são enviados para stdout ou clientes.
      if(res.headersSent){res.destroy();return;}
      const response=deny(error?.code===413 ? 413:500,error?.code===413 ? 'Corpo de requisição excede 1 MiB.':'Falha interna do servidor MCP.');
      await sendNodeResponse(res,response,origin,config.allowedOrigins);
    }
  });
}
