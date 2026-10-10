import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let sdkInstalled=true;
try { require.resolve('@modelcontextprotocol/server'); require.resolve('zod/v4'); }
catch { sdkInstalled=false; }

function openClient() {
  const child=spawn(process.execPath,['server/index.mjs'],{
    cwd:fileURLToPath(new URL('..',import.meta.url)),
    env:{...process.env,TRANSPARENCIA_API_KEY:'',TRANSPARENCIA_OPENAPI_MODE:'offline'},
  });
  const pending=new Map();
  const rl=readline.createInterface({input:child.stdout});
  let stderr='';
  child.stderr.on('data',chunk=>{stderr+=chunk.toString().slice(0,500);});
  rl.on('line',line=>{
    let value;
    try { value=JSON.parse(line); }
    catch { throw new Error(`Saída não JSON-RPC no stdout: ${line.slice(0,100)}`); }
    const resolve=pending.get(value.id);
    if(resolve){pending.delete(value.id);resolve(value);}
  });
  let i=0;
  return {
    async call(method,params={}) {
      const id=++i;
      const wait=new Promise((resolve,reject)=>{
        pending.set(id,resolve);
        setTimeout(()=>{if(pending.has(id)){pending.delete(id);reject(new Error(`MCP não respondeu: ${stderr}`));}},5000).unref();
      });
      child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');
      return wait;
    },
    notify(method, params={}) { child.stdin.write(JSON.stringify({jsonrpc:'2.0',method,params})+'\n'); },
    close(){child.kill();rl.close();}
  };
}

test('SDK oficial MCP: handshake legado, ferramentas, status e erro sem chave',async()=>{
    assert.ok(sdkInstalled,'SDK oficial não instalado. Execute npm install antes do teste MCP; este teste não deve ser ignorado.');
    const client=openClient();
    try {
      const init=await client.call('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'teste',version:'1.0'}});
      assert.equal(init.result.serverInfo.name,'portal-transparencia-brasil');
      client.notify('notifications/initialized');
      const list=await client.call('tools/list');
      assert.deepEqual(list.result.tools.map(t=>t.name),['portal_catalogo','portal_consultar','portal_status']);
      const catalog=await client.call('tools/call',{name:'portal_catalogo',arguments:{limite:250}});
      assert.equal(catalog.result.isError,false);
      assert.equal(JSON.parse(catalog.result.content[0].text).operacoes.length,109);
      const status=await client.call('tools/call',{name:'portal_status',arguments:{}});
      assert.equal(JSON.parse(status.result.content[0].text).autenticacao_configurada,false);
      assert.equal(JSON.parse(status.result.content[0].text).openapi.fallback_local,true);
      const missing=await client.call('tools/call',{name:'portal_consultar',arguments:{operacao:'orgaosSiafi'}});
      assert.equal(missing.result.isError,true);
      assert.match(missing.result.content[0].text,/Configure TRANSPARENCIA_API_KEY/);
    } finally {client.close();}
  });
