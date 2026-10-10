import { readFileSync } from 'node:fs';

export const OFFICIAL_BASE_URL = 'https://api.portaldatransparencia.gov.br';
export const OFFICIAL_OPENAPI_URL = `${OFFICIAL_BASE_URL}/v3/api-docs`;
export const SNAPSHOT_PATH = new URL('../data/portal-openapi.json', import.meta.url);
const MAX_SPEC_BYTES = 3 * 1024 * 1024;
const SIMPLE_TYPES = new Set(['integer', 'number', 'string', 'boolean']);
const VALID_PATH = /^\/api-de-dados\/[A-Za-z0-9._~/%{}-]+$/;

function validateSpec(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new Error('Documento OpenAPI inválido.');
  if (!/^3\.[01](?:\.|$)/.test(spec.openapi ?? '')) throw new Error('Somente OpenAPI 3.0/3.1 é aceito.');
  const title = String(spec.info?.title ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (!title.includes('portal da transparencia')) throw new Error('A documentação não corresponde ao Portal da Transparência.');
  if (!spec.paths || typeof spec.paths !== 'object' || Array.isArray(spec.paths)) throw new Error('Sem mapa de rotas.');
  if (!Array.isArray(spec.servers) || spec.servers.length === 0) throw new Error('Origem oficial ausente no OpenAPI.');
  for (const server of spec.servers) {
    if (typeof server.url !== 'string') throw new Error('Origem do OpenAPI inválida.');
    let origin;
    try { origin = new URL(server.url); } catch { throw new Error('URL da origem do OpenAPI inválida.'); }
    if (origin.origin !== OFFICIAL_BASE_URL || (origin.pathname !== '/' && origin.pathname !== '')) {
      throw new Error('OpenAPI informa uma origem fora da CGU.');
    }
  }

  const byOperation = new Map();
  const byPath = new Map();
  for (const [path, pathItem] of Object.entries(spec.paths)) {
    if (!VALID_PATH.test(path) || path.includes('//') || path.includes('%') || path.split('/').some(seg => seg === '.' || seg === '..')) {
      throw new Error('OpenAPI contém uma rota fora da área permitida.');
    }
    if (!pathItem || typeof pathItem !== 'object' || Array.isArray(pathItem)) throw new Error('Definição de rota inválida.');
    const operation = pathItem.get;
    if (!operation) continue; // nunca expor métodos que não sejam GET
    if (!operation || typeof operation !== 'object' || Array.isArray(operation)) throw new Error('Operação GET inválida.');
    const operationId = operation.operationId;
    if (typeof operationId !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(operationId)) {
      throw new Error('operationId ausente ou inválida no OpenAPI.');
    }
    if (byOperation.has(operationId)) throw new Error('operationId duplicada no OpenAPI.');
    const parameters = [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])];
    if (!Array.isArray(parameters)) throw new Error('Lista de parâmetros inválida.');
    const seen = new Set();
    for (const p of parameters) {
      if (!p || typeof p !== 'object' || ('$ref' in p)) throw new Error('Parâmetro não resolvido ou inválido.');
      if (!['query', 'path'].includes(p.in) || typeof p.name !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(p.name)) {
        throw new Error('Local ou nome de parâmetro não permitido.');
      }
      if (!SIMPLE_TYPES.has(p.schema?.type)) throw new Error('Tipo de parâmetro não suportado.');
      const key = `${p.in}:${p.name}`;
      if (seen.has(key)) throw new Error('Parâmetro duplicado no OpenAPI.');
      seen.add(key);
      if (p.in === 'path' && (!p.required || !path.includes(`{${p.name}}`))) {
        throw new Error('Parâmetro de rota ausente ou não obrigatório.');
      }
    }
    for (const variable of path.match(/\{[^}]+\}/g) ?? []) {
      if (!parameters.some(p => p.in === 'path' && variable === `{${p.name}}`)) throw new Error('Marcador de rota não declarado.');
    }
    const item = { path, ...operation, parameters };
    byOperation.set(operationId, item);
    byPath.set(path, item);
  }
  if (byOperation.size === 0) throw new Error('OpenAPI sem operações GET válidas.');
  return { byOperation, byPath, count:byOperation.size, spec };
}

const SNAPSHOT = validateSpec(JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')));
export const SNAPSHOT_OPERATION_COUNT = SNAPSHOT.count;
let active = SNAPSHOT;
let lastCheck = {
  modo: 'offline',
  origem: 'local',
  ultima_verificacao: null,
  situacao: 'snapshot_local',
  alteracoes: null,
  erro: null,
};

export function catalogState() { return active; }
export function openApiStatus() {
  return {
    ...lastCheck,
    operacoes_base: SNAPSHOT.count,
    operacoes_ativas: active.count,
    fallback_local: active === SNAPSHOT,
  };
}

export function compareOpenApi(candidate) {
  const updated = validateSpec(candidate);
  const incompatibilities = [];
  const added = [];
  const optionalAdditions = [];
  const descriptionsChanged = [];
  for (const [opId, before] of SNAPSHOT.byOperation) {
    const now = updated.byOperation.get(opId);
    if (!now) { incompatibilities.push(`Operação removida: ${opId}`); continue; }
    if (before.path !== now.path) { incompatibilities.push(`Rota alterada: ${opId}`); continue; }
    const next = new Map(now.parameters.map(p => [`${p.in}:${p.name}`, p]));
    const previous = new Set(before.parameters.map(p => `${p.in}:${p.name}`));
    for (const p of before.parameters) {
      const key = `${p.in}:${p.name}`;
      const after = next.get(key);
      if (!after) { incompatibilities.push(`Filtro removido: ${opId}.${p.name}`); continue; }
      if (p.schema?.type !== after.schema?.type || (!p.required && after.required)) {
        incompatibilities.push(`Contrato de filtro alterado: ${opId}.${p.name}`);
      }
    }
    for (const p of now.parameters) {
      if (previous.has(`${p.in}:${p.name}`)) continue;
      if (p.required) incompatibilities.push(`Novo filtro obrigatório: ${opId}.${p.name}`);
      else optionalAdditions.push(`${opId}.${p.name}`);
    }
    if (before.summary !== now.summary || before.description !== now.description) descriptionsChanged.push(opId);
  }
  for (const id of updated.byOperation.keys()) if (!SNAPSHOT.byOperation.has(id)) added.push(id);
  return {
    candidate: updated,
    alterations: {
      operacoes_adicionadas: added,
      parametros_opcionais_adicionados: optionalAdditions,
      descricoes_alteradas: descriptionsChanged,
      incompatibilidades: incompatibilities,
    },
    compatible: incompatibilities.length === 0,
  };
}

async function boundedText(response) {
  const reportedLength = Number(response.headers?.get?.('content-length') ?? 0);
  if (reportedLength > MAX_SPEC_BYTES) throw new Error('OpenAPI remoto excedeu 3 MiB.');
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    let size = 0;
    const chunks = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_SPEC_BYTES) throw new Error('OpenAPI remoto excedeu 3 MiB.');
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    return new TextDecoder().decode(Buffer.concat(chunks));
  }
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_SPEC_BYTES) throw new Error('OpenAPI remoto excedeu 3 MiB.');
  return text;
}

/**
 * Política opt-in. 'check' somente compara; 'refresh' promove APENAS mudanças
 * compatíveis. Falha de rede/validação volta ao snapshot local, sem escrevê-lo.
 * Não aceita URLs arbitrárias: a única origem é a da CGU.
 */
export async function updateOpenApi({ mode='offline', fetchFn=fetch, timeoutMs=8000 }={}) {
  if (!['offline', 'check', 'refresh'].includes(mode)) throw new Error('Modo OpenAPI inválido (offline, check ou refresh).');
  if (mode === 'offline') {
    lastCheck = { modo: mode, origem: active === SNAPSHOT ? 'local' : 'remoto', ultima_verificacao: lastCheck.ultima_verificacao, situacao:'verificacao_desativada', alteracoes:lastCheck.alteracoes, erro:null };
    return openApiStatus();
  }
  const checkedAt = new Date().toISOString();
  try {
    const response = await fetchFn(OFFICIAL_OPENAPI_URL, {
      method:'GET', headers:{Accept:'application/json'}, redirect:'error', signal:AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`Servidor da CGU respondeu HTTP ${response.status}.`);
    const mime = response.headers?.get?.('content-type') ?? '';
    if (mime && !/\bjson\b/i.test(mime)) throw new Error('O Swagger oficial não retornou JSON.');
    const candidate = JSON.parse(await boundedText(response));
    const compared = compareOpenApi(candidate);
    if (!compared.compatible) throw new Error(`Mudança incompatível (${compared.alterations.incompatibilidades.length} conflito(s)).`);
    if (mode === 'refresh') active = compared.candidate;
    lastCheck = {
      modo: mode,
      origem: active === SNAPSHOT ? 'local' : 'remoto',
      ultima_verificacao: checkedAt,
      situacao: mode === 'check' ? 'validado_sem_aplicacao' : 'remoto_validado_aplicado',
      alteracoes: compared.alterations,
      erro: null,
    };
  } catch (error) {
    active = SNAPSHOT;
    const reason = error?.name === 'TimeoutError' ? 'Tempo limite excedido.'
      : error instanceof SyntaxError ? 'JSON inválido.'
      : (/^(Servidor da CGU respondeu HTTP \d{3}\.|OpenAPI remoto excedeu 3 MiB\.|O Swagger oficial não retornou JSON\.|Mudança incompatível \(\d+ conflito\(s\)\)\.)$/.test(error?.message ?? '')
          ? error.message : 'Falha na validação ou conexão com o OpenAPI remoto.');
    lastCheck = {
      modo: mode, origem: 'local', ultima_verificacao: checkedAt,
      situacao: 'fallback_local', alteracoes: null, erro: reason,
    };
  }
  return openApiStatus();
}

/** Somente para testes; não é ferramenta MCP. */
export function resetOpenApiForTests() {
  active = SNAPSHOT;
  lastCheck = { modo:'offline', origem:'local', ultima_verificacao:null, situacao:'snapshot_local', alteracoes:null, erro:null };
}
