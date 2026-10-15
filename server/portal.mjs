import { catalogState, openApiStatus, OFFICIAL_BASE_URL, SNAPSHOT_OPERATION_COUNT } from './openapi.mjs';
import { setTimeout as delay } from 'node:timers/promises';

// Reserva 15 segundos do limite Vercel para autenticação, inicialização e resposta MCP.
export const QUERY_TIMEOUT_MS = 45000;

/** API oficial da CGU. Não permite host arbitrário ou URL fornecida pelo usuário. */
const BASE_URL = OFFICIAL_BASE_URL;
export const API_ENDPOINT_COUNT = SNAPSHOT_OPERATION_COUNT;
export const API_BASE = BASE_URL;

const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const normalizeDigits = value => String(value).replace(/\D/g, '');
const isCPFKey = key => /cpf|nis|matricula|numeroInscricaoSocial|c[oó]digoBeneficiario|c[oó]digoResponsavelFamiliar/i.test(key);
const isCPFValue = str => /^\d{11}$/.test(normalizeDigits(str)) && String(str).length <= 14;
function maskDocument(value) {
  const digits = normalizeDigits(value);
  if (digits.length === 11) return `***.***.***-${digits.slice(-2)}`;
  return '***';
}
export function redact(value, key = '') {
  if (Array.isArray(value)) return value.map(x => redact(x, key));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, redact(v, k)]));
  }
  if (typeof value === 'string') {
    if ((isCPFKey(key) || /codigoPessoa|codigoFavorecido|codigoSancionado/i.test(key)) && isCPFValue(value)) {
      return maskDocument(value);
    }
    // Redige CPFs formatados que eventualmente surjam dentro de campos de texto livre.
    return value.replace(/(?<!\d)\d{3}\.\d{3}\.\d{3}-\d{2}(?!\d)/g, match => maskDocument(match));
  }
  return value;
}

export function catalog({ assunto = '', busca = '', limite = 30 } = {}) {
  if (!Number.isInteger(limite) || limite < 1 || limite > 250) {
    throw new Error('limite deve ser um inteiro de 1 a 250.');
  }
  const category = norm(assunto);
  const search = norm(busca);
  const { byOperation } = catalogState();
  const items = [...byOperation.values()].filter(item => {
    const categoryText = norm((item.tags || []).join(' '));
    const text = norm([item.operationId, item.summary, item.description, item.path, ...(item.tags || [])].join(' '));
    return (!category || categoryText.includes(category) || text.includes(category))
      && (!search || search.split(/\s+/).every(token => text.includes(token)));
  });
  return {
    total_operacoes: byOperation.size,
    encontrados: items.length,
    exibidos: Math.min(items.length, limite),
    operacoes: items.slice(0, limite).map(item => ({
      operacao: item.operationId,
      assunto: item.tags?.[0] ?? null,
      descricao: item.summary ?? item.description ?? '',
      rota: item.path,
      parametros_obrigatorios: (item.parameters ?? []).filter(p => p.required && p.in !== 'header').map(p => ({ nome:p.name, local:p.in, descricao:plain(p.description).slice(0, 180) })),
      parametros_opcionais: (item.parameters ?? []).filter(p => !p.required && p.in !== 'header').map(p => p.name),
    })),
    catalogo_parcial: items.length > limite,
    origem: `${BASE_URL}/swagger-ui/index.html`,
  };
}

function plain(input='') { return String(input).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }
function dateParts(d) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d);
  if (!m) return null;
  const [day, month, year] = [+m[1], +m[2], +m[3]];
  const test = new Date(Date.UTC(year,month - 1,day));
  if (test.getUTCDate() !== day || test.getUTCMonth() !== month - 1 || test.getUTCFullYear() !== year) return null;
  return [year,month,day];
}
function compareDates(a,b) {
  const x=dateParts(a), y=dateParts(b);
  if (!x || !y) throw new Error('Datas devem ser válidas no formato DD/MM/AAAA.');
  return Date.UTC(...[x[0],x[1]-1,x[2]]) - Date.UTC(...[y[0],y[1]-1,y[2]]);
}
function checkRange(params, start, end, maxDays) {
  if (params[start] == null && params[end] == null) return;
  if (params[start] == null || params[end] == null) throw new Error(`Informe ${start} e ${end} juntos.`);
  if (compareDates(params[start],params[end]) > 0) throw new Error(`Período inválido: ${start} posterior a ${end}.`);
  const delta = Math.abs(compareDates(params[end], params[start]))/(24*60*60*1000);
  if (delta > maxDays) throw new Error(`O intervalo de ${start} a ${end} excede ${maxDays} dias. Divida em consultas menores.`);
}
function checkExtraRules(operation, p) {
  if (operation === 'dadosServidores' && ![p.cpf,p.orgaoServidorExercicio,p.orgaoServidorLotacao].some(Boolean)) {
    throw new Error('Para consultar servidores, a CGU exige CPF ou código de órgão de exercício/lotação (SIAPE); nome isolado não basta.');
  }
  if (operation === 'remuneracoesServidores' && !p.cpf && p.id === undefined) {
    throw new Error('Informe cpf ou id do servidor, além de mesAno (AAAAMM).');
  }
  if (operation === 'despesasPorOrgao' && !p.orgao && !p.orgaoSuperior) {
    throw new Error('Informe orgao ou orgaoSuperior (código SIAFI).');
  }
  if (operation.startsWith('despesasPorFuncao') && !['funcao','subfuncao','programa','acao','grupoDespesa','elementoDespesa','modalidadeAplicacao','idPlanoOrcamentario'].some(k => p[k] != null)) {
    throw new Error('Informe pelo menos um filtro de classificação orçamentária além do ano.');
  }
  if (operation === 'documentos' && !p.unidadeGestora && !p.gestao) {
    throw new Error('Informe unidadeGestora ou gestao, além de dataEmissao e fase.');
  }
  if (operation === 'pf' && !p.cpf && !p.nis) {
    throw new Error('Informe cpf ou nis.');
  }
  if (operation === 'cartao' && ![p.codigoOrgao,p.cpfPortador,p.cpfCnpjFavorecido,p.mesExtratoInicio].some(Boolean)) {
    throw new Error('Informe um órgão, portador, favorecido ou período.');
  }
  if (operation === 'licitacoes') checkRange(p,'dataInicial','dataFinal',31);
  if (operation === 'viagensPorPeriodoEOrgao') {
    checkRange(p,'dataIdaDe','dataIdaAte',31);
    checkRange(p,'dataRetornoDe','dataRetornoAte',31);
  }
  if (operation === 'convenios') {
    for (const [a,b] of [['dataInicial','dataFinal'],['dataUltimaLiberacaoInicial','dataUltimaLiberacaoFinal'],['dataVigenciaInicial','dataVigenciaFinal']]) checkRange(p,a,b,1);
  }
  if (operation === 'cartao' && p.mesExtratoInicio && p.mesExtratoFim) {
    const ok = /^\d{2}\/\d{4}$/;
    if (!ok.test(p.mesExtratoInicio) || !ok.test(p.mesExtratoFim)) throw new Error('Mês do extrato deve estar no formato MM/AAAA.');
    const [m1,y1]=p.mesExtratoInicio.split('/').map(Number),[m2,y2]=p.mesExtratoFim.split('/').map(Number);
    if (m1<1||m1>12||m2<1||m2>12 || y2*12+m2 < y1*12+m1 || y2*12+m2 - (y1*12+m1) > 11) throw new Error('Período de extratos deve ter no máximo 12 meses válidos.');
  }
}

function coerceParameter(param, val) {
  const type=param.schema?.type;
  if (val === null || typeof val === 'object' || Array.isArray(val)) throw new Error(`Parâmetro ${param.name} inválido: esperado valor simples.`);
  if (type === 'integer') {
    const num=Number(val);
    if (!Number.isSafeInteger(num) || num < 0) throw new Error(`Parâmetro ${param.name} deve ser inteiro não negativo.`);
    if (param.name === 'pagina' && num < 1) throw new Error('Parâmetro pagina deve ser inteiro positivo.');
    if (/mesAno|anoMes|mesAnoLancamento/i.test(param.name)) {
      const month=num % 100;
      if (num < 190001 || month < 1 || month > 12) throw new Error(`${param.name} deve estar no formato AAAAMM válido.`);
    }
    if (/^ano$|^anoInicio$/i.test(param.name) && (num < 1900 || num > 2100)) throw new Error(`${param.name} deve ser ano válido.`);
    return String(num);
  }
  if (type === 'string') {
    const s=String(val).trim();
    if (!s || s.length > 256) throw new Error(`Parâmetro ${param.name} vazio ou excessivamente longo.`);
    if (/^data[A-Z]|^dat[A-Z]/.test(param.name) && !dateParts(s)) {
      throw new Error(`${param.name} exige data válida em DD/MM/AAAA.`);
    }
    if (/^(mesAnoInicio|mesAnoFim|mesExtratoInicio|mesExtratoFim)$/.test(param.name)) {
      const mm=/^(\d{2})\/(\d{4})$/.exec(s);
      if (!mm || Number(mm[1]) < 1 || Number(mm[1]) > 12) throw new Error(`${param.name} exige MM/AAAA válido.`);
    }
    if (/^\d{2}\/\d{4}$/.test(s) && /mesExtrato/.test(param.name)) {
      const month=Number(s.slice(0,2)); if (month < 1||month>12) throw new Error(`${param.name}: mês inválido.`);
    }
    return s;
  }
  return String(val);
}

export function prepareQuery(operation, args={}) {
  const { byOperation, byPath } = catalogState();
  const item = byOperation.get(operation) ?? byPath.get(operation);
  if (!item) throw new Error('Operação não encontrada no catálogo oficial. Consulte portal_catalogo para descobrir nomes válidos.');
  if (args === null || Array.isArray(args) || typeof args !== 'object') throw new Error('parametros deve ser um objeto de filtros.');
  const defined = new Map((item.parameters ?? []).map(p => [p.name,p]));
  for (const key of Object.keys(args)) {
    if (key === 'pagina') throw new Error('Defina a página em pagina_inicial, fora de parametros.');
    if (!defined.has(key)) throw new Error(`Filtro não suportado em ${item.operationId}: ${key}. Consulte portal_catalogo.`);
  }
  const p = {};
  for (const def of defined.values()) {
    const v=args[def.name];
    if (v === null || v === undefined || v === '') {
      if (def.required && def.name !== 'pagina') throw new Error(`Filtro obrigatório ausente: ${def.name}.`);
      continue;
    }
    p[def.name] = coerceParameter(def,v);
  }
  checkExtraRules(item.operationId,p);
  let path=item.path;
  const query = new URLSearchParams();
  for (const param of item.parameters ?? []) {
    if (param.in === 'path') {
      if (!(param.name in p)) throw new Error(`Parâmetro de rota obrigatório: ${param.name}.`);
      path=path.replace(`{${param.name}}`,encodeURIComponent(p[param.name]));
    } else if (param.in === 'query' && p[param.name] !== undefined) query.set(param.name,p[param.name]);
  }
  if (path.includes('{')) throw new Error('Parâmetros obrigatórios da rota incompletos.');
  if (!path.startsWith('/api-de-dados/')) throw new Error('Rota fora da lista permitida.');
  return { endpoint:item, path, query, parameters:p };
}

let queue=Promise.resolve();
let lastRequestAt=0;
async function paceRequests(signal) {
  signal.throwIfAborted();
  const task=queue.then(async()=> {
    signal.throwIfAborted();
    // No máximo 1 requisição por segundo neste processo; limite conservador.
    const wait=Math.max(0, 1000 - (Date.now()-lastRequestAt));
    if (wait) await delay(wait, undefined, { signal });
    signal.throwIfAborted();
    lastRequestAt=Date.now();
  });
  queue=task.catch(()=>{});
  // O prazo também deve interromper a espera anterior ao início do callback.
  let onAbort;
  const cancelled=new Promise((_,reject)=> {
    onAbort=()=>reject(signal.reason);
    signal.addEventListener('abort',onAbort,{once:true});
    if (signal.aborted) onAbort();
  });
  try {
    await Promise.race([task,cancelled]);
  } finally {
    signal.removeEventListener('abort',onAbort);
  }
}
function safeErrorText(text,key) {
  let s=String(text ?? '').slice(0,500);
  if (key) s=s.split(key).join('[SEGREDO]');
  return redact(s).replace(/(?<!\d)\d{11}(?!\d)/g,'[IDENTIFICADOR]').replace(/https?:\/\/[^\s"']+/g,'[URL ocultada]');
}

async function getJSON(url,key,fetchFn,pace,querySignal) {
  for (let attempt=0;attempt<3;attempt++) {
    querySignal.throwIfAborted();
    if (pace) await paceRequests(querySignal);
    const signal=AbortSignal.any([querySignal, AbortSignal.timeout(20000)]);
    let response;
    try { response=await fetchFn(url,{method:'GET',headers:{'Accept':'application/json','chave-api-dados':key},signal}); }
    catch (e) {
      if (e?.name==='TimeoutError' || e?.name==='AbortError') throw new Error('Tempo de resposta da API excedido (20 segundos).');
      throw new Error('Falha de comunicação com a API da CGU.');
    }
    if (response.status===429 && attempt<2) {
      let wait=Number(response.headers?.get?.('Retry-After'));
      if (!Number.isFinite(wait) || wait<1 || wait>10) wait=attempt+1;
      await delay(wait*1000, undefined, { signal: querySignal });
      continue;
    }
    if (response.status===401 || response.status===403) throw new Error('Chave da API rejeitada ou acesso proibido (HTTP 401/403). Verifique TRANSPARENCIA_API_KEY.');
    if (!response.ok) throw new Error(`API da CGU retornou HTTP ${response.status}: ${safeErrorText(await response.text(),key)}`);
    const contentType=response.headers?.get?.('content-type') ?? '';
    if (contentType && !contentType.includes('json')) throw new Error('API retornou formato inesperado (não JSON).');
    try { return await response.json(); }
    catch { throw new Error('A API retornou JSON inválido.'); }
  }
  throw new Error('Limite de chamadas da API excedido (HTTP 429). Reduza a frequência.');
}

export async function queryPortal({ operacao, parametros={}, pagina_inicial=1, max_paginas=1, limite_registros=50 }={}, options={}) {
  const timeoutMs = options.timeoutMs ?? QUERY_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > QUERY_TIMEOUT_MS) {
    throw new Error('Prazo da consulta inválido.');
  }
  const querySignal = AbortSignal.timeout(timeoutMs);
  try {
    return await runQuery({ operacao, parametros, pagina_inicial, max_paginas, limite_registros }, options, querySignal);
  } catch (error) {
    if (querySignal.aborted) throw new Error('Prazo total da consulta excedido (45 segundos no máximo). Reduza max_paginas ou divida os filtros em consultas menores.');
    throw error;
  }
}

async function runQuery({ operacao, parametros, pagina_inicial, max_paginas, limite_registros }, options, querySignal) {
  if (!Number.isInteger(pagina_inicial) || pagina_inicial<1 || pagina_inicial>100000) throw new Error('pagina_inicial deve estar entre 1 e 100000.');
  if (!Number.isInteger(max_paginas) || max_paginas<1 || max_paginas>5) throw new Error('max_paginas deve estar entre 1 e 5.');
  if (!Number.isInteger(limite_registros) || limite_registros<1 || limite_registros>200) throw new Error('limite_registros deve estar entre 1 e 200.');
  const key=options.apiKey ?? process.env.TRANSPARENCIA_API_KEY;
  if (!key || !key.trim()) throw new Error('Chave da CGU ausente. Configure TRANSPARENCIA_API_KEY no ambiente local do servidor MCP; não envie a chave no chat.');
  const {endpoint,path,query,parameters}=prepareQuery(operacao,parametros);
  const fetchFn=options.fetchFn ?? fetch;
  const pace=options.pace ?? true;
  const records=[];
  let scalar=null, pagesRead=0, hasNextUnknown=false;
  for (let i=0;i<max_paginas;i++) {
    const thisQuery=new URLSearchParams(query);
    if ((endpoint.parameters??[]).some(p=>p.name==='pagina')) thisQuery.set('pagina',String(pagina_inicial+i));
    else if (i>0) break;
    const url=new URL(path,BASE_URL);
    url.search=thisQuery.toString();
    const body=await getJSON(url,key,fetchFn,pace,querySignal);
    pagesRead++;
    if (Array.isArray(body)) {
      records.push(...body.slice(0, Math.max(0, limite_registros-records.length)));
      if (body.length===0) {hasNextUnknown=false;break;}
      hasNextUnknown=true;
      if (records.length>=limite_registros) break;
    } else {
      scalar=body;hasNextUnknown=false;break;
    }
  }
  return {
    operacao: endpoint.operationId,
    descricao: endpoint.summary ?? '',
    fonte_oficial: `${BASE_URL}${path}`,
    referencia_documentacao: `${BASE_URL}/swagger-ui/index.html`,
    consultado_em: new Date().toISOString(),
    filtros: redact(parameters),
    paginas_consultadas:pagesRead,
    primeira_pagina:pagina_inicial,
    registros_retornados:records.length,
    completo: !hasNextUnknown,
    aviso_abrangencia: hasNextUnknown ? 'Resposta potencialmente parcial: mais páginas podem existir. Não apresente esta amostra como total da base.' : null,
    dados: redact(scalar ?? records)
  };
}

export function status() {
  return {
    fonte: BASE_URL,
    operacoes_disponiveis: catalogState().count,
    openapi: openApiStatus(),
    autenticacao_configurada: Boolean(process.env.TRANSPARENCIA_API_KEY?.trim()),
    observacao: 'Status de configuração local. Não testa chave nem disponibilidade da API. A chave não é exibida.'
  };
}
