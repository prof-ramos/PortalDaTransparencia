import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { guardHttpRequest, createRemoteServer, parseRemoteConfig, MAX_REQUEST_BYTES } from '../server/http-core.mjs';

const SECRET='fixture-very-long-random-static-owner-token-0123456789';
const baseEnv={ MCP_ACCESS_TOKEN:SECRET, MCP_PUBLIC_URL:'http://127.0.0.1:3000/mcp', MCP_ALLOWED_ORIGINS:'https://chatgpt.com,https://work.example.test', HOST:'127.0.0.1',PORT:'0' };
const cfg=()=>parseRemoteConfig(baseEnv);
const req=(path='/mcp',headers={},method='POST')=>new Request('http://127.0.0.1:3000'+path,{method,headers});
const bearer={authorization:'Bearer '+SECRET};

test('configuração exige token forte e HTTPS externo',()=>{
  assert.throws(()=>parseRemoteConfig({ ...baseEnv, MCP_ACCESS_TOKEN:'123' }),/MCP_ACCESS_TOKEN/);
  assert.throws(()=>parseRemoteConfig({ ...baseEnv, MCP_PUBLIC_URL:'http://remote.example/mcp' }),/HTTPS/);
  assert.throws(()=>parseRemoteConfig({ ...baseEnv, MCP_PUBLIC_URL:'https://host.example/other' }),/terminar em \/mcp/);
  assert.throws(()=>parseRemoteConfig({ ...baseEnv, MCP_ALLOWED_ORIGINS:'http://foreign.example' }),/HTTPS/);
  assert.throws(()=>parseRemoteConfig({ ...baseEnv, HOST:'0.0.0.0' }),/interface de rede pública/);
  assert.equal(parseRemoteConfig({...baseEnv,MCP_PUBLIC_URL:'https://remote.example/mcp'}).publicUrl.host,'remote.example');
});

test('autenticação Bearer, host e origin são aplicados antes de chamar MCP',async()=>{
  const config=cfg();
  assert.equal(guardHttpRequest(req('/mcp'),config).status,401);
  assert.equal(guardHttpRequest(req('/mcp',{authorization:'Bearer errado'}),config).status,401);
  assert.equal(guardHttpRequest(req('/mcp',bearer),config),null);
  assert.equal(guardHttpRequest(req('/mcp',{...bearer,origin:'https://other.example'}),config).status,403);
  assert.equal(guardHttpRequest(req('/mcp',{...bearer,origin:'https://chatgpt.com'}),config),null);
  assert.equal(guardHttpRequest(new Request('http://other.example/mcp',{method:'POST',headers:bearer}),config).status,421);
});

test('saúde é limitada; MCP protegido; CORS sem wildcard',async()=>{
  const config=cfg();
  const health=guardHttpRequest(req('/healthz',{},'GET'),config);
  assert.equal(health.status,200);
  assert.deepEqual(await health.json(),{status:'ok'});
  assert.equal(guardHttpRequest(req('/admin',bearer),config).status,404);
  assert.equal(guardHttpRequest(req('/mcp?token=foo',bearer),config).status,404);
  const preflight=guardHttpRequest(req('/mcp',{origin:'https://chatgpt.com'},'OPTIONS'),config);
  assert.equal(preflight.status,204);
  assert.equal(preflight.headers.get('access-control-allow-origin'),'https://chatgpt.com');
  assert.equal(preflight.headers.get('access-control-allow-credentials'),null);
  assert.equal(guardHttpRequest(req('/mcp',{origin:'https://evil.example'},'OPTIONS'),config).status,403);
  assert.equal(guardHttpRequest(req('/mcp',bearer,'PUT'),config).status,405);
});

test('rejeita body declarado acima de 1 MiB',()=>{
  const config=cfg();
  const res=guardHttpRequest(req('/mcp',{...bearer,'content-length':String(MAX_REQUEST_BYTES+1)}),config);
  assert.equal(res.status,413);
});

test('middleware HTTP integra protocolo via handler injetado, sem expor credenciais',async()=>{
  let calls=0;
  const config={...cfg()};
  const server=createRemoteServer({ config, mcpHandler: {fetch:async request=>{
    calls++;
    assert.equal(request.url,config.publicUrl.href);
    assert.equal(request.headers.get('authorization'),'Bearer '+SECRET);
    assert.deepEqual(await request.json(),{jsonrpc:'2.0',id:1,method:'ping'});
    return Response.json({jsonrpc:'2.0',id:1,result:{ok:true}});
  }}});
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const address=server.address();
  const target=`http://127.0.0.1:${address.port}`;
  config.publicUrl=new URL(target+'/mcp');
  try {
    const missing=await fetch(`${target}/mcp`,{method:'POST',headers:{},body:'{}'});
    assert.equal(missing.status,401);
    const status=await fetch(`${target}/healthz`,{headers:{}});
    assert.deepEqual(await status.json(),{status:'ok'});
    const yes=await fetch(`${target}/mcp`,{method:'POST',headers:{...bearer,Host:'127.0.0.1:'+address.port,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'ping'})});
    assert.equal(yes.status,200);
    assert.deepEqual(await yes.json(),{jsonrpc:'2.0',id:1,result:{ok:true}});
    assert.equal(calls,1);
    const wrongHost=await new Promise((resolve,reject)=>{
      const request=httpRequest(`${target}/mcp`,{method:'POST',headers:{Host:'outro.host',Authorization:'Bearer '+SECRET}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});
      request.on('error',reject);request.end('{}');
    });
    assert.equal(wrongHost,421);
    assert.equal(calls,1);
    const tooBig=await fetch(`${target}/mcp`,{method:'POST',headers:{...bearer,Host:'127.0.0.1:'+address.port},body:'x'.repeat(MAX_REQUEST_BYTES+1)});
    assert.equal(tooBig.status,413);
    assert.equal(calls,1);
  } finally {server.close();}
});
