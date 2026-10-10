# Hospedagem HTTPS e OAuth

## Decisão de arquitetura

Projeto Vercel separado: `portal-transparencia-mcp`, na equipe `gabriel-ramos-projects-c715690c`.

Endpoint: `https://portal-transparencia-mcp.vercel.app/mcp`.

O transporte usa uma Vercel Function Node.js com o mesmo servidor MCP e catálogo de 109 operações. O SDK atende requisições sem estado. O modo local stdio e o servidor HTTP privado com Bearer estático continuam disponíveis separadamente.

Auth0 é o provedor escolhido para OAuth, sem implementação própria de login, emissão de tokens ou armazenamento de senhas. O fluxo do ChatGPT usa Authorization Code com PKCE S256. O servidor valida JWT assinado por RS256/ES256, emissor exato, audience igual ao endpoint MCP, expiração obrigatória, escopo `portal:read` e `sub` igual ao proprietário. Tokens de outras contas não dão acesso, mesmo que o login tenha sido concluído.

## Estado em 10/10/2026

- Adaptação Vercel e proteção OAuth implementadas; 30 testes locais aprovados, sem testes ignorados.
- Projeto publicado com HTTPS. `MCP_PUBLIC_URL` configurada no ambiente Production.
- Verificação externa do deployment final: `/healthz` retorna 200; `/mcp` e descoberta OAuth retornam 503 enquanto a configuração está incompleta; código-fonte, snapshot e `.env.example` retornam 404.
- Auth0 configurado no tenant `dev-13gcst6cz1kdv3rb`: API RS256 com `portal:read`, cliente público Native de terceiros `ChatGPT — Portal da Transparência BR`, Authorization Code e refresh tokens rotativos. Acesso delegado confirmado com 1/1 permissão; acesso de máquina e anônimo com 0/1. Ainda falta identificar o usuário de login autorizado.
- Enquanto `OAUTH_ISSUER`, `OAUTH_JWKS_URL` e `OAUTH_OWNER_SUB` não estiverem configuradas, `/mcp` e os metadados retornam 503. Não há fallback para acesso anônimo ou Bearer estático na Vercel.
- A chave CGU precisa estar no ambiente protegido da função para consultas reais. Nenhuma chave foi adicionada nesta etapa.
- Conexão do ChatGPT e fluxo de login ponta a ponta ainda não homologados.

## Configuração Auth0 a concluir

1. Registrar a API com Identifier `https://portal-transparencia-mcp.vercel.app/mcp`, assinatura RS256 e permissão `portal:read`.
2. Habilitar Resource Parameter Compatibility Profile para que o parâmetro OAuth `resource` determine a audience do token.
3. Verificar o documento de descoberta do tenant: PKCE S256 e método de registro/identificação do cliente escolhido devem estar anunciados corretamente.
4. Preferir cliente OAuth previamente registrado para este uso privado, com apenas Authorization Code e refresh tokens rotativos quando necessário. Permitir somente o callback exato mostrado no painel do servidor MCP do ChatGPT; não inferir callback nem usar wildcard. Conceder acesso somente à API e ao escopo `portal:read`.
5. Configurar `OAUTH_ISSUER`, `OAUTH_JWKS_URL` e `OAUTH_OWNER_SUB` na Vercel. O `sub` deve ser a identidade Auth0 do usuário que efetivamente fará o login do plugin; a conta administrativa do dashboard não substitui automaticamente essa identidade.
6. Inserir `TRANSPARENCIA_API_KEY` diretamente no ambiente protegido da Vercel ou por gerenciador de segredos, sem passar pela conversa.
7. Reimplantar e validar descoberta, desafio 401, login/consentimento pelo ChatGPT, listagem de ferramentas e consulta CGU autenticada.

## 1Password

O aplicativo está com o servidor MCP habilitado, e o Codex tem o servidor local `1password` registrado com o comando `1password-mcp`. A conexão foi autenticada pelo MCP. O ambiente dedicado `Portal da Transparência — Produção` foi criado e recebeu `MCP_PUBLIC_URL`, `OAUTH_ISSUER` e `OAUTH_JWKS_URL`, confirmadas por listagem de nomes. A identidade autorizada e a chave CGU ainda não foram adicionadas; nenhum arquivo local foi montado.

Usar exclusivamente as ferramentas do MCP local para modificar o ambiente dedicado. Listar ambientes e nomes existentes antes de adicionar variáveis, sem ler ou imprimir valores secretos. A chave CGU deve ser inserida pelo proprietário no 1Password, sem passar pela conversa.

| Variável | Finalidade | Proteção |
| --- | --- | --- |
| `MCP_PUBLIC_URL` | `https://portal-transparencia-mcp.vercel.app/mcp` | Pública |
| `OAUTH_ISSUER` | `https://dev-13gcst6cz1kdv3rb.us.auth0.com/` | Pública |
| `OAUTH_JWKS_URL` | `https://dev-13gcst6cz1kdv3rb.us.auth0.com/.well-known/jwks.json` | Pública |
| `OAUTH_OWNER_SUB` | Identidade do proprietário obtida após login no aplicativo | Oculta |
| `TRANSPARENCIA_API_KEY` | Credencial da API CGU | Oculta |

O identificador público do cliente ChatGPT é `tpc_wV1psLSyir5uYZ5vNroHU8`; ele pertence à configuração do plugin e não exige Client Secret. Callback registrado: `https://chatgpt.com/connector_platform_oauth_redirect`. O tenant anuncia a resposta de autorização com `iss`, exigida para esse callback estável.

O ambiente 1Password não sincroniza automaticamente com a Vercel. A implantação precisa receber as variáveis no ambiente Production, por um mecanismo seguro, e ser reimplantada. A montagem local `.env` deve ser feita pelo MCP e verificada pelos metadados de montagem, sem abrir o arquivo para conferir segredos.

## Operação do endpoint

`GET /healthz` verifica a execução da função e não certifica configuração OAuth ou conectividade CGU. Os metadados são publicados em `/.well-known/oauth-protected-resource` e `/.well-known/oauth-protected-resource/mcp`. A proteção retorna o URL de descoberta no cabeçalho `WWW-Authenticate`.

Somente `public/` é servido como conteúdo estático. Código, catálogo, manifestos e testes não devem ser servidos por URLs estáticas. O snapshot OpenAPI é incluído apenas no pacote da função. Limite de corpo: 1 MiB. Respostas MCP não são armazenadas em cache.

O pacing de consultas existente é por instância; ele não implementa um limite global entre instâncias Vercel. Para o uso individual, começar com os limites existentes (até cinco páginas por chamada), observar a quota CGU e só adicionar armazenamento/limitação distribuída se houver necessidade comprovada.

## Referências

- [Autenticação de plugins OpenAI](https://developers.openai.com/plugins/build/auth)
- [Funções Vercel e Web handlers](https://vercel.com/docs/functions/functions-api-reference)
- [Auth0: compatibilidade do parâmetro resource](https://support.auth0.com/center/s/article/mcp-audience-error-with-auth0)
- [Auth0: controles de aplicações de terceiros](https://auth0.com/docs/get-started/applications/third-party-applications/security-controls)
