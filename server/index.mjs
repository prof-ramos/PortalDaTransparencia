#!/usr/bin/env node
/** Transporte e registro de ferramentas implementados pelo SDK oficial MCP v2. */
import { McpServer } from '@modelcontextprotocol/server';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { catalog, queryPortal, status } from './portal.mjs';
import { updateOpenApi } from './openapi.mjs';

const VERSION = '0.3.0';
const annotations = { readOnlyHint:true, destructiveHint:false, openWorldHint:true };

function success(payload) {
  return { content:[{ type:'text', text:JSON.stringify(payload,null,2) }], isError:false };
}
function failure(error) {
  // Erros de execução devem ser resultados MCP, sem retornar stack traces nem segredos.
  return { content:[{ type:'text', text:`Falha na consulta: ${error?.message || 'Erro não identificado.'}` }], isError:true };
}
function registerSafe(server, name, config, handler) {
  server.registerTool(name, config, async args => {
    try { return success(await handler(args)); }
    catch (error) { return failure(error); }
  });
}

export function buildServer({ oauthScope } = {}) {
  const server = new McpServer(
    { name:'portal-transparencia-brasil', version:VERSION },
    { maxToolInputElements:100 },
  );

  const authMeta = oauthScope ? { _meta: { securitySchemes: [{ type:'oauth2', scopes:[oauthScope] }] } } : {};
  registerSafe(server, 'portal_catalogo', {
    ...authMeta,
    title:'Encontrar consultas no Portal da Transparência',
    description:'Encontra as operações oficiais disponíveis por assunto ou expressão, com os filtros suportados. Use ANTES de chamar portal_consultar quando não conhecer a operationId exata. A base local cobre os 109 endpoints de consulta GET do OpenAPI fornecido; o catálogo pode crescer após atualização oficial validada.',
    annotations,
    inputSchema: z.strictObject({
      assunto: z.string().describe('Categoria, por exemplo Servidores, Viagens, Contratos, Sanções, Despesas ou Benefícios.').optional(),
      busca: z.string().describe('Palavras-chave da consulta pretendida.').optional(),
      limite: z.number().int().min(1).max(250).default(30).describe('Máximo de operações retornadas.'),
    }),
  }, args => catalog(args));

  registerSafe(server, 'portal_consultar', {
    ...authMeta,
    title:'Consultar dados oficiais da CGU',
    description:'Executa uma rota GET da API oficial do Portal da Transparência usando operationId, filtros documentados e paginação controlada. Requer TRANSPARENCIA_API_KEY; rejeita filtros não documentados e mascara CPFs/NIS retornados.',
    annotations,
    inputSchema: z.strictObject({
      operacao: z.string().min(1).describe('operationId EXATA obtida em portal_catalogo, ou path registrado.'),
      parametros: z.record(z.string(), z.union([z.string(),z.number()])).default({}).describe('Filtros oficiais (nomes exatos). Datas DD/MM/AAAA, competências AAAAMM.'),
      pagina_inicial: z.number().int().min(1).max(100000).default(1),
      max_paginas: z.number().int().min(1).max(5).default(1),
      limite_registros: z.number().int().min(1).max(200).default(50),
    }),
  }, args => queryPortal(args));

  registerSafe(server, 'portal_status', {
    ...authMeta,
    title:'Status da configuração do Portal',
    description:'Informa se uma chave da CGU foi configurada no ambiente local e quantas consultas a integração suporta, sem consultar a API nem expor a chave. Inclui origem e resultado da verificação do OpenAPI.',
    annotations,
    inputSchema: z.strictObject({}),
  }, () => status());

  return server;
}

async function main() {
  const mode = process.env.TRANSPARENCIA_OPENAPI_MODE?.trim()?.toLowerCase() || 'offline';
  const info = await updateOpenApi({ mode });
  if (info.situacao === 'fallback_local') {
    process.stderr.write(`Portal: OpenAPI remoto não aplicado; catálogo local mantido (${info.erro}).\n`);
  }
  // serveStdio gerencia framing, versionamento, handshake legado e ciclo de vida.
  const handle = serveStdio(buildServer);
  const close = () => { void handle.close(); };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    process.stderr.write('Não foi possível iniciar o servidor MCP. Confira o SDK instalado e a configuração OpenAPI.\n');
    process.exitCode = 1;
  });
}
