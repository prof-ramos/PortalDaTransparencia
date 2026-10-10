import test from 'node:test';
import assert from 'node:assert/strict';
import { API_ENDPOINT_COUNT, catalog, prepareQuery, queryPortal, redact } from '../server/portal.mjs';

const mockFetch = (calls) => async (url, options) => {
  calls.push({ url: url.toString(), method: options.method, header: options.headers['chave-api-dados'] });
  const page=Number(url.searchParams.get('pagina') ?? 1);
  return { status:200, ok:true, headers:{get:()=> 'application/json'}, json:async()=> page===1 ? [{codigo:'123',descricao:'Órgão fictício',cpf:'123.456.789-00',nis:'12345678900'}] : [] };
};

test('catálogo contém as 109 operações e permite filtrar por assunto', () => {
  assert.equal(API_ENDPOINT_COUNT,109);
  const c=catalog({assunto:'Sanções'});
  assert.equal(c.encontrados,10);
  assert.ok(c.operacoes.some(x=>x.operacao==='ceis'));
  assert.ok(c.operacoes.every(x=>x.rota.startsWith('/api-de-dados/')));
});

test('parâmetros obrigatórios, restrições de busca e rotas permitidas',()=>{
  assert.throws(()=>prepareQuery('dadosServidores',{nome:'Qualquer pessoa'}),/CPF ou código de órgão/i);
  assert.throws(()=>prepareQuery('remuneracoesServidores',{mesAno:202601}),/cpf ou id/i);
  assert.throws(()=>prepareQuery('orgaosSiafi',{filtroSecreto:'x'}),/não suportado/i);
  assert.throws(()=>prepareQuery('/admin',{pagina:1}),/não encontrada/i);
  assert.throws(()=>prepareQuery('licitacoes',{codigoOrgao:'35000',dataInicial:'01/01/2026',dataFinal:'01/03/2026'}),/31 dias/i);
  assert.throws(()=>prepareQuery('orgaosSiape',{pagina:0}),/pagina_inicial/i);
  assert.throws(()=>prepareQuery('despesasPorOrgao',{ano:2025,orgao:'35000',pagina:1}),/pagina_inicial/i);
  assert.throws(()=>prepareQuery('viagensPorPeriodoEOrgao',{codigoOrgao:'123',dataIdaDe:'31/02/2026',dataIdaAte:'28/02/2026',dataRetornoDe:'01/03/2026',dataRetornoAte:'02/03/2026'}),/data válida/i);
  const p=prepareQuery('despesasPorOrgao',{ano:2025,orgao:'35000'});
  assert.equal(p.endpoint.operationId,'despesasPorOrgao');
});

test('consulta paginada com origem fixa e chave exclusivamente no cabeçalho', async()=>{
  const calls=[];
  const result=await queryPortal({operacao:'orgaosSiafi',max_paginas:2,limite_registros:10},{apiKey:'token-local-de-teste',fetchFn:mockFetch(calls),pace:false});
  assert.equal(calls.length,2);
  assert.equal(result.completo,true);
  assert.equal(result.registros_retornados,1);
  assert.equal(result.dados[0].cpf,'***.***.***-00');
  assert.equal(result.dados[0].nis,'***.***.***-00');
  assert.equal(result.dados[0].descricao,'Órgão fictício');
  assert.equal(calls[0].method,'GET');
  assert.ok(calls[0].url.startsWith('https://api.portaldatransparencia.gov.br/api-de-dados/orgaos-siafi'));
  assert.ok(!calls[0].url.includes('token-local-de-teste'));
  assert.equal(calls[0].header,'token-local-de-teste');
  assert.ok(!JSON.stringify(result).includes('token-local-de-teste'));
});

test('amostra parcial explicitada quando ainda existem linhas na última página',async()=>{
  const result=await queryPortal({operacao:'orgaosSiafi',max_paginas:1},{apiKey:'fake',fetchFn:mockFetch([]),pace:false});
  assert.equal(result.completo,false);
  assert.match(result.aviso_abrangencia,/parcial/i);
});

test('bloqueia consultas sem credencial e operações demasiado grandes',async()=>{
  await assert.rejects(queryPortal({operacao:'orgaosSiafi'},{apiKey:''}),/Chave da CGU ausente/);
  await assert.rejects(queryPortal({operacao:'orgaosSiafi',max_paginas:20},{apiKey:'fake'}),/entre 1 e 5/);
});

test('redige CPF dentro de strings e respeita CNPJ',()=>{
  assert.equal(redact('123.456.789-00'),'***.***.***-00');
  assert.equal(redact({codigoFavorecido:'12345678900',cnpj:'12345678000190'}).codigoFavorecido,'***.***.***-00');
  assert.equal(redact({cnpj:'12345678000190'}).cnpj,'12345678000190');
});


test('falhas de autenticação não revelam o segredo e retornos HTTP são controlados',async()=>{
  const secret='minha-chave-secreta-interna';
  const fetchFn=async()=>({status:401,ok:false,headers:{get:()=>null},text:async()=>`Não autorizado ${secret}`});
  await assert.rejects(queryPortal({operacao:'orgaosSiafi'},{apiKey:secret,fetchFn,pace:false}),error=>{
    assert.match(error.message,/HTTP 401\/403/);
    assert.ok(!error.message.includes(secret));
    return true;
  });
});
