# Regras operacionais e exemplos de busca

## Conversão de pedidos para filtros

1. Fixe a categoria, escolha a operação pelo `operationId` e resolva siglas/códigos na fonte.
2. Quando o usuário disser «mês passado», use o mês civil anterior no fuso aplicável e converta para `AAAAMM` ou intervalo `DD/MM/AAAA`; nunca substitua referência temporal silenciosamente.
3. Endpoints de pessoal usam códigos SIAPE; licitações, contratos, despesas e viagens usam códigos SIAFI. Não confunda com CNPJ da organização.
4. `pagina` é um parâmetro da API. O servidor MCP controla a paginação por `pagina_inicial`/`max_paginas`; não é necessário inserir `pagina` em `parametros`.
5. Mais de um vínculo pode pertencer à mesma pessoa; não trate a quantidade de vínculos como quantidade de indivíduos.
6. Remuneração pode conter verbas indenizatórias, pagamentos em dólar, rubricas e deduções; esclareça o campo utilizado em cada total.
7. Despesas: valor empenhado não é necessariamente valor pago. Quando comparar fases, mantenha as classificações originais.
8. Em consultas sem data permitida pelo endpoint, evite presumir que um resultado representa todo o histórico do dado.

## Abrangência e exaustividade

- O MCP restringe uma chamada a 1–5 páginas e até 200 registros, evitando varreduras automáticas e exceder limites.
- A propriedade `completo` será falsa se a última página consultada ainda contiver registros, pois não há garantia de ser a última página; para afirmar total de registros, pagine até encontrar uma página vazia ou obtenha uma fonte de agregação oficial.
- Para busca anual com endpoint limitado por mês/dia, faça subconsultas somente nas janelas indispensáveis, preservando o escopo originalmente pedido.
- Se o usuário quer totais por órgão, prefira o endpoint agregado `/despesas/por-orgao` aos registros documentais.
- Respeite restrições adicionais de cadastro governamental, portarias e política de privacidade aplicável.

## Fontes oficiais

- Especificação: https://api.portaldatransparencia.gov.br/swagger-ui/index.html
- Portal da Transparência: https://portaldatransparencia.gov.br/api-de-dados
- Cadastro da chave: https://portaldatransparencia.gov.br/api-de-dados/cadastrar-email

A página de cadastro descreve limites superiores a alguns textos de apresentação da API. O servidor limita-se preventivamente a aproximadamente 60 requisições por minuto, sem presumir aumento da cota concedida ao usuário.

## Atualização do catálogo OpenAPI

- `TRANSPARENCIA_OPENAPI_MODE=offline` (padrão): snapshot original.
- `TRANSPARENCIA_OPENAPI_MODE=check`: consulta/valida documentação oficial uma vez na inicialização, sem aplicá-la.
- `TRANSPARENCIA_OPENAPI_MODE=refresh`: apenas alterações aditivas/compatíveis podem ser promovidas em memória. Incompatibilidade, erro ou timeout restauram as 109 operações locais.
- Consulte `portal_status.openapi` antes de afirmar que uma operação recém-publicada está disponível.
- A atualização não grava nem altera `data/portal-openapi.json`. O catálogo remoto não foi testado em produção na ausência de chave válida.
