---
name: onboarding
description: Configure com segurança o plugin privado Portal da Transparência BR após instalação, valide o servidor MCP local ou remoto e oriente o primeiro uso sem solicitar chaves de acesso em conversa.
---

# Configuração inicial — Portal da Transparência BR

O objetivo é habilitar consultas em linguagem natural à API do Portal da Transparência da CGU. O plugin é independente e não representa a Controladoria-Geral da União. Não presuma que a publicação do pacote ativa o servidor ou concede acesso à API.

1. Identifique se o usuário possui uma conexão MCP funcional. Não declare conexão pronta apenas porque o plugin está instalado. Se ferramentas estiverem disponíveis, execute `portal_status` com `{}` e use os campos da resposta para verificar operação do catálogo, atualização do OpenAPI e presença da variável CGU.
2. Explique brevemente que a CGU exige chave da API, obtida em `https://portaldatransparencia.gov.br/api-de-dados/cadastrar-email`. Não peça para colar chave, token, senha ou CPF em conversa. A configuração deve ocorrer no ambiente seguro onde o servidor roda.
3. Para execução local, orientar `npm ci` quando o pacote tiver `package-lock.json` válido, senão `npm install`, seguido de `npm test` e `npm start`; a variável é `TRANSPARENCIA_API_KEY`. A configuração de variáveis de ambiente não deve ser compartilhada por mensagem.
4. Para execução remota, esclarecer que são necessários HTTPS, conexão MCP registrada no cliente e um `MCP_ACCESS_TOKEN` privado e independente da chave da CGU. O endpoint somente suporta autenticação Bearer estática nesta versão, destinada a uso individual; **não** declare suporte OAuth ou acesso público a múltiplos usuários. A implantação remota não está inclusa no plugin ZIP.
5. Não exigir Structured Settings ou uma interface MCP App: esta versão não as implementa. Não crie ferramentas fictícias.
6. Após conectar, verifique `portal_status` e faça uma consulta de baixo custo usando `portal_catalogo` com `{"busca":"órgãos","limite":5}`. Consultas reais à CGU devem ocorrer somente quando a chave foi configurada corretamente e quando solicitadas pelo usuário.
7. Se houver erro, descreva claramente se é problema de dependência/SDK, inicialização MCP, autenticação remota, chave CGU, limitação de API ou falta de hospedagem. Não ofereça suposições de sucesso.

Preserve as três ferramentas existentes: `portal_catalogo`, `portal_consultar`, `portal_status`. Para diferenças de suporte por plataforma, consulte a especificação `https://github.com/openai/mcp-extensions/blob/main/docs/spec.md`; o navegador Work não corresponde ao ChatGPT web clássico.
