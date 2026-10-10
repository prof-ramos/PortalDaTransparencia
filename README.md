# Portal da Transparência BR — plugin privado (v0.3.0)

Plugin independente para consultar **dados públicos do Portal da Transparência da CGU** em português-BR. **Não é uma aplicação oficial da CGU.** Não está hospedado pelo registro do plugin no ChatGPT.

## Escopo e compatibilidade

- Preserva as **109 operações GET** da especificação OpenAPI anexada, com descoberta de operações adicionais após atualização compatível validada.
- **Três ferramentas MCP preservadas:** `portal_catalogo`, `portal_consultar`, `portal_status` (mesmos nomes e filtros da v0.2.0).
- SDK MCP oficial `@modelcontextprotocol/server` **2.3.1**, transporte local **stdio** e transporte **HTTP stateless** pelo mesmo `buildServer` e SDK `createMcpHandler`, compatíveis com versões modernas/legadas do protocolo.
- Validação de rotas e parâmetros, máscara de CPF/NIS, limites de consulta (até 5 páginas/200 registros), rate pacing (~1 solicitação/segundo) e controle de atualização OpenAPI.
- Onboarding ChatGPT declarado em `plugin.json` em `skills/onboarding/SKILL.md`.
- Node.js **20+** no runtime; Node.js 22 LTS recomendado.

## Instalação local

Instale o Node e, no diretório raiz do plugin, execute:

```sh
npm ci --ignore-scripts --omit=dev
npm test
npm start # requer TRANSPARENCIA_API_KEY previamente configurada no ambiente seguro
```

Substitua a configuração da chave por um cofre/gerenciador de segredos ou variável segura **no processo que executa o servidor**, evitando inserir o valor em terminal/histórico. Obtenha a chave da CGU em <https://portaldatransparencia.gov.br/api-de-dados/cadastrar-email>. O campo `chave-api-dados` é enviado somente à API oficial.

O transporte local continuará disponível em `mcp.json` e `.mcp.json`. Eles não contêm segredos.

## Servidor HTTP remoto (uso individual)

**Adaptação local para Vercel (10/10/2026):** a função `api/mcp.js` usa OAuth JWT e descoberta de recurso protegido, com acesso restrito ao proprietário. O projeto HTTPS foi criado; configuração Auth0 e conexão ChatGPT ainda estão pendentes. Veja [hospedagem e estado da configuração](docs/HOSPEDAGEM.md). A seção abaixo descreve o servidor Node privado original da v0.3.0.

A versão 0.3.0 inclui `server/http.mjs`, com autenticação obrigatória por Bearer estático **independente da chave CGU**, em um endpoint `/mcp` sobre um **proxy TLS/HTTPS** configurado pelo administrador. Esta é uma implementação de **servidor privado de usuário único**. OAuth 2.1, múltiplas contas e autenticação interativa do ChatGPT **não foram implementados**.

Variáveis obrigatórias para produção:

| Variável | Uso |
| --- | --- |
| `TRANSPARENCIA_API_KEY` | Chave oficial da API CGU (apenas no servidor). |
| `MCP_ACCESS_TOKEN` | Segredo aleatório de ao menos 32 caracteres, gerado e armazenado fora do código; identifica o único administrador. |
| `MCP_PUBLIC_URL` | URL pública HTTPS exata, terminando em `/mcp` (por exemplo, `https://seu-dominio.example/mcp`). |
| `HOST` | Interface de escuta interna (padrão: `127.0.0.1`; `0.0.0.0` apenas atrás de proxy TLS). |
| `PORT` | Porta interna (padrão: `3000`). |
| `MCP_ALLOWED_ORIGINS` | Lista opcional de origens HTTPS autorizadas para requisições com cabeçalho `Origin`; valores separados por vírgula. Não utiliza `*`. |

Inicie com `npm run start:http`. No TLS proxy, encaminhe `Host` original ao backend e proteja o canal proxy/backend em rede privada, pois o Node HTTP escuta sem TLS próprio. Proxy que substitua o host original precisa ajustar o encaminhamento em vez de desativar a verificação.

- `GET /healthz`: apenas `{"status":"ok"}` (não expõe configuração nem credenciais).
- `/mcp`: apenas GET, POST ou DELETE, exige Bearer. Preflight OPTIONS aceita somente origem da allowlist.
- Respostas com `Cache-Control: no-store`, limite de corpo de 1 MiB, sem informação sensível em erros.
- `MCP_PUBLIC_URL` não-local exige HTTPS; uma URL local proíbe escuta em interface pública.

**Atenção:** `MCP_ACCESS_TOKEN` é um token de conexão privada, não um fluxo OAuth; alguns clientes MCP/ChatGPT podem não aceitar Bearer preconfigurado. A hospedagem, a emissão de token, a integração OAuth com ChatGPT e a conexão real do plugin **não fazem parte desta versão nem foram testadas**. Não publique o servidor na internet sem revisar também firewall, TLS, rotação de segredos, controle de abuso e observabilidade.

## Atualização controlada do OpenAPI

A variável `TRANSPARENCIA_OPENAPI_MODE` controla a verificação na inicialização:

| Valor | Comportamento |
| --- | --- |
| `offline` (padrão) | Usa as 109 operações originais do snapshot local. |
| `check` | Confere diferenças do OpenAPI oficial, não aplica mudanças. |
| `refresh` | Aceita novas operações GET e filtros opcionais compatíveis; mantém snapshot anterior como fallback em memória. |

O update é restrito a `https://api.portaldatransparencia.gov.br/v3/api-docs`, GET, 8 s, até 3 MiB, sem redirects. Só aceita origem CGU, rotas `/api-de-dados/`, tipos simples e compatibilidade com os filtros conhecidos. Operações não GET jamais são incorporadas. O snapshot original não é alterado. `portal_status.openapi` expõe o estado da verificação (sem chave nem dados privados).

## Testes

```sh
npm run test:offline # lógica das 109 operações, OpenAPI e autenticação HTTP, sem SDK npm
npm test             # suite completa, inclusive inicialização com SDK real
```

O teste MCP real deve falhar caso o SDK não esteja instalado: isso é um erro de ambiente, não um teste aprovado. As verificações contra a **API autenticada de produção da CGU** não podem ser realizadas sem uma chave válida.

### Validação local — 10/10/2026

- Dependências instaladas e fixadas em `package-lock.json`: SDK MCP 2.3.1 e Zod 4.6.4.
- `npm test`: 27 testes aprovados, nenhuma falha ou teste ignorado, com Node.js 26.10.0 e npm 11.19.1 no macOS.
- Handshake MCP `2025-06-18`, descoberta e chamadas das três ferramentas verificados por `stdio` e HTTP local com o SDK real; catálogo com 109 operações, status e erro controlado de consulta sem chave.
- Testes de consultas bem-sucedidas à CGU usam respostas simuladas. Consultas autenticadas reais, hospedagem HTTPS e conexão pelo ChatGPT permanecem pendentes.
- CI configurado para instalar pelo lockfile com `npm ci` e executar a suíte em Node.js 20 e 22; essa matriz não foi executada nesta validação local.

## Evolução planejada (não incluída nesta versão)

- OAuth/fluxo de conexão ao ChatGPT com isolamento por usuário e armazenamento seguro de credenciais.
- SDK `@openai/mcp-extensions`, Structured Settings e uma interface MCP App (barra lateral), após confirmar versões npm compatíveis e hospedagem.
- `ui/update-model-context` e testes de interface para desktop/iOS.
- Provisionamento e deploy de um endpoint MCP real. O cadastro de plugin na conta não implanta código remoto.

## Referências

- MCP SDK v2: <https://ts.sdk.modelcontextprotocol.io/v2/>
- MCP Extensions: <https://github.com/openai/mcp-extensions/blob/main/docs/spec.md>
- Padrões de interface: <https://github.com/openai/mcp-extensions/blob/main/docs/patterns.md>
- API CGU: <https://api.portaldatransparencia.gov.br/swagger-ui/index.html>

Licença da API/especificação conforme CGU. O pacote não redistribui segredos.
