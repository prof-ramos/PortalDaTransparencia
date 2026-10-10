#!/usr/bin/env node
/** Inicialização do MCP HTTP remoto. TLS é obrigatório no proxy HTTPS. */
import { createMcpHandler } from '@modelcontextprotocol/server';
import { buildServer } from './index.mjs';
import { updateOpenApi } from './openapi.mjs';
import { createRemoteServer, parseRemoteConfig } from './http-core.mjs';

async function main() {
  const config=parseRemoteConfig();
  await updateOpenApi({mode:process.env.TRANSPARENCIA_OPENAPI_MODE?.trim()?.toLowerCase()||'offline'});
  const handler=createMcpHandler(buildServer,{legacy:'stateless'});
  const http=createRemoteServer({mcpHandler:handler,config});
  const shutdown=async()=>{
    http.close();
    await handler.close();
  };
  process.once('SIGINT',()=>{void shutdown();});
  process.once('SIGTERM',()=>{void shutdown();});
  await new Promise((resolve,reject)=>{
    http.once('error',reject);
    http.listen(config.port,config.host,resolve);
  });
  // Sem credenciais ou metadados de clientes nos logs.
  process.stderr.write('MCP HTTP inicializado. Endpoint /mcp; saúde /healthz.\n');
}

main().catch(()=>{
  process.stderr.write('Falha ao iniciar MCP HTTP. Verifique variáveis, dependências e configuração de rede.\n');
  process.exitCode=1;
});
