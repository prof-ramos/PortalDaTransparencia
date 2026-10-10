# Changelog

## Alterações locais — 2026-10-10 (sobre 0.3.0)


- Adaptação Vercel com descoberta OAuth, validação JWT e restrição ao proprietário; nova dependência `jose` fixada no lockfile.
- Testes OAuth elevam a suíte a 30 testes aprovados. Configuração do provedor e homologação ChatGPT permanecem pendentes.

- Dependências instaladas e lockfile gerado para instalação reproduzível; CI passa a usar `npm ci`.
- Catálogo com 109 operações verificado também pelo transporte `stdio` real.
- Novo teste HTTP com SDK real cobre autenticação, handshake, descoberta e chamadas das três ferramentas.
- Suíte local: 27 testes aprovados, sem testes ignorados. Validação autenticada contra a CGU e conexão pública continuam pendentes.

## 0.3.0 — 2026-10-09

- Servidor HTTP `/mcp` com `createMcpHandler` oficial, mantendo o mesmo `buildServer` utilizado em `stdio`.
- Autenticação privada obrigatória, host/origin checks, HTTPS público obrigatório e limite de 1 MiB por requisição.
- Endpoint de saúde sem dados sensíveis e respostas HTTP sem cache.
- Onboarding declarado no manifesto OpenAI, com configuração e verificação segura.
- Testes de autenticação HTTP, validação de configuração e integração mock HTTP.
- Ajuste não destrutivo do limite máximo de exibição do catálogo, de 109 para 250 operações, permitindo expansão validada.

## 0.2.0

- Migração do servidor MCP para o SDK oficial v2.
- Verificação opcional e atualização compatível do OpenAPI com fallback local.

## 0.1.0

- Catálogo de 109 operações GET da API oficial CGU, consulta paginada e status da integração.
