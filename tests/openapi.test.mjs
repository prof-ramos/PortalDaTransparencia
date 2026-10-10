import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { API_ENDPOINT_COUNT, catalog, prepareQuery, status } from '../server/portal.mjs';
import {
  OFFICIAL_OPENAPI_URL,
  compareOpenApi,
  updateOpenApi,
  resetOpenApiForTests,
} from '../server/openapi.mjs';

const baseline = JSON.parse(readFileSync(new URL('../data/portal-openapi.json', import.meta.url), 'utf8'));
const copy = () => structuredClone(baseline);
function mockResponse(spec, calls=[]) {
  return async (url, options) => {
    calls.push({url, method:options.method, redirect:options.redirect, headers:options.headers});
    return {ok:true,status:200,headers:{get:key=> key==='content-type'?'application/json':null},text:async()=>JSON.stringify(spec)};
  };
}
function expanded() {
  const candidate=copy();
  candidate.paths['/api-de-dados/entidade-nova']={
    get:{operationId:'entidadeNova',summary:'Nova operação oficial de leitura',tags:['Órgãos'],parameters:[{name:'pagina',in:'query',required:true,schema:{type:'integer'}}]}
  };
  return candidate;
}

test('snapshot tem as 109 operações GET anteriores', () => {
  resetOpenApiForTests();
  assert.equal(API_ENDPOINT_COUNT,109);
  assert.equal(catalog({limite:109}).total_operacoes,109);
  assert.equal(status().openapi.origem,'local');
});

test('modo offline não utiliza rede nem altera a base local',async()=>{
  resetOpenApiForTests();
  const result=await updateOpenApi({mode:'offline',fetchFn:()=>{throw new Error('REDE NÃO PODE SER CHAMADA');}});
  assert.equal(result.situacao,'verificacao_desativada');
  assert.equal(result.operacoes_ativas,109);
});

test('modo check valida diferenças e mantém snapshot sem promover alterações',async()=>{
  resetOpenApiForTests();
  const calls=[];
  const result=await updateOpenApi({mode:'check',fetchFn:mockResponse(expanded(),calls)});
  assert.equal(result.situacao,'validado_sem_aplicacao');
  assert.equal(result.origem,'local');
  assert.equal(result.operacoes_ativas,109);
  assert.deepEqual(result.alteracoes.operacoes_adicionadas,['entidadeNova']);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,OFFICIAL_OPENAPI_URL);
  assert.equal(calls[0].method,'GET');
  assert.equal(calls[0].redirect,'error');
  assert.equal(calls[0].headers['chave-api-dados'],undefined);
  assert.throws(()=>prepareQuery('entidadeNova'),/não encontrada/i);
});

test('modo refresh promove novas GET compatíveis em memória sem alterar o arquivo local',async()=>{
  resetOpenApiForTests();
  const result=await updateOpenApi({mode:'refresh',fetchFn:mockResponse(expanded())});
  assert.equal(result.situacao,'remoto_validado_aplicado');
  assert.equal(result.origem,'remoto');
  assert.equal(result.operacoes_ativas,110);
  assert.equal(catalog({limite:110}).operacoes.length,110);
  assert.equal(status().operacoes_disponiveis,110);
  assert.equal(prepareQuery('entidadeNova').path,'/api-de-dados/entidade-nova');
  assert.equal(JSON.parse(readFileSync(new URL('../data/portal-openapi.json', import.meta.url),'utf8')).paths['/api-de-dados/entidade-nova'],undefined);
  resetOpenApiForTests();
});

test('adições opcionais são compatíveis e novas obrigações são bloqueadas',()=>{
  const compatible=copy();
  compatible.paths['/api-de-dados/orgaos-siafi'].get.parameters.push({name:'opcionalNovo',in:'query',required:false,schema:{type:'string'}});
  assert.equal(compareOpenApi(compatible).compatible,true);
  assert.deepEqual(compareOpenApi(compatible).alterations.parametros_opcionais_adicionados,['orgaosSiafi.opcionalNovo']);
  const incompatible=copy();
  incompatible.paths['/api-de-dados/orgaos-siafi'].get.parameters.push({name:'exigenciaNova',in:'query',required:true,schema:{type:'string'}});
  assert.equal(compareOpenApi(incompatible).compatible,false);
});

test('remoções e mudança do contrato de filtros são incompatíveis',()=>{
  const deleted=copy();
  delete deleted.paths['/api-de-dados/orgaos-siape'];
  assert.equal(compareOpenApi(deleted).compatible,false);
  const changed=copy();
  changed.paths['/api-de-dados/orgaos-siafi'].get.parameters[0].schema.type='integer';
  assert.equal(compareOpenApi(changed).compatible,false);
});

test('resposta maliciosa, origem externa e URL fora da CGU são rejeitadas',async()=>{
  resetOpenApiForTests();
  const evil=expanded();
  evil.servers[0].url='https://site-invalido.example';
  assert.throws(()=>compareOpenApi(evil),/origem fora da CGU/i);
  const url=expanded();
  url.paths['/outro-sistema/acao']={get:{operationId:'acao',parameters:[]}};
  assert.throws(()=>compareOpenApi(url),/rota fora/i);
  const traversal=expanded();
  traversal.paths['/api-de-dados/../../admin']={get:{operationId:'admin',parameters:[]}};
  assert.throws(()=>compareOpenApi(traversal),/rota fora/i);
  const badJson=await updateOpenApi({mode:'refresh',fetchFn:async()=>({ok:true,status:200,headers:{get:()=> 'application/json'},text:async()=>'{err'})});
  assert.equal(badJson.situacao,'fallback_local');
  assert.equal(badJson.erro,'JSON inválido.');
  assert.equal(badJson.operacoes_ativas,109);
});

test('se atualização incompatível ou indisponível ocorrer, retorna ao snapshot de 109',async()=>{
  resetOpenApiForTests();
  await updateOpenApi({mode:'refresh',fetchFn:mockResponse(expanded())});
  const incompatible=expanded();
  delete incompatible.paths['/api-de-dados/orgaos-siafi'];
  let result=await updateOpenApi({mode:'refresh',fetchFn:mockResponse(incompatible)});
  assert.equal(result.situacao,'fallback_local');
  assert.match(result.erro,/Mudança incompatível/);
  assert.equal(catalog({}).total_operacoes,109);
  await updateOpenApi({mode:'refresh',fetchFn:mockResponse(expanded())});
  result=await updateOpenApi({mode:'refresh',fetchFn:async()=>{throw new Error('token secreto ou URL externa');}});
  assert.equal(result.situacao,'fallback_local');
  assert.equal(result.operacoes_ativas,109);
  assert.ok(!JSON.stringify(result).includes('token secreto'));
  resetOpenApiForTests();
});

test('métodos não GET nunca são expostos no catálogo',()=>{
  const candidate=expanded();
  candidate.paths['/api-de-dados/operacao-post']={post:{operationId:'mutacaoPerigosa',parameters:[]}};
  const compared=compareOpenApi(candidate);
  assert.equal(compared.candidate.count,110);
  assert.equal(compared.candidate.byOperation.has('mutacaoPerigosa'),false);
});

test('payload acima do limite de 3 MiB ativa fallback',async()=>{
  resetOpenApiForTests();
  const result=await updateOpenApi({mode:'refresh',fetchFn:async()=>({ok:true,status:200,headers:{get: k => k==='content-length' ? String(4*1024*1024) : 'application/json'},text: async()=>'{}'})});
  assert.equal(result.situacao,'fallback_local');
  assert.equal(result.erro,'OpenAPI remoto excedeu 3 MiB.');
});
