# Buscador de preços

Aplicação para consultar ofertas atuais por EAN em diferentes marketplaces. O MongoDB armazena somente o catálogo da empresa; preços e resultados não são persistidos.

## Estrutura

- `price-monitor-api`: Node.js, Express, MongoDB e integrações de busca.
- `price-monitor-web`: frontend estático em HTML, CSS e JavaScript.
- `Dockerfile`: deploy da API no Koyeb.
- `.github/workflows/pages.yml`: deploy do frontend no GitHub Pages.

## Variáveis da API

Consulte `price-monitor-api/.env.example`. Em produção, configure no Koyeb:

- `MONGODB_URI`
- `SERPAPI_KEY`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `JWT_SECRET`
- `DEMO_MODE=false`
- `CORS_ORIGINS=https://kertcosmeticos.github.io`

## Frontend

Crie no GitHub a variável de repositório `API_URL` com a URL pública da API no Koyeb. O workflow injeta esse endereço durante a publicação sem alterar o desenvolvimento local.

Instruções detalhadas também estão nos READMEs de cada pasta.

## Catálogo de produtos

A aba **Cadastros** permite incluir produtos individualmente ou importar até 2.000 itens por arquivo Excel (`.xls` ou `.xlsx`). A própria tela oferece uma planilha-modelo e mostra o progresso da importação por lotes.

As colunas aceitas são `COD SFA`, `NOME`, `GRAMATURA`, `CODBARRAS`, `CATEGORIA` e `FAMILIA`. O painel publica como modelo a base atualizada `PRODUTOS EM LINHA 2026 - BASE LARISSA.xlsx`. O EAN identifica cada produto: um EAN novo é cadastrado e um EAN existente é atualizado, sem criar duplicidades.

## Pesquisa pelo Chrome

A pasta `price-monitor-chrome` contém uma extensão Manifest V3 que pesquisa Google Web, Google Shopping e Mercado Livre usando a sessão local do navegador, sem consumir SerpApi. O workflow do Pages publica também `price-monitor-chrome.zip`, disponível no próprio painel.

A extensão combina EAN, nome oficial e uma consulta semântica por tipo, linha e variante. O resultado só é aceito quando nome compatível, preço em reais e link direto pertencem ao mesmo anúncio B2C. Cor/nuance e tipo compatível são obrigatórios.

Cada consulta pesquisa automaticamente todos os sites ativos cadastrados. A API e a extensão direcionam as pesquisas a esses domínios, usam o conector específico do Mercado Livre quando ele faz parte do cadastro e colocam os sites consultados em estado de aprendizado. Domínios incompatíveis com marketplaces conhecidos são ignorados pelo motor.

A busca ampla também pode identificar um domínio ainda não cadastrado. Ele só é sugerido quando possui oferta com link direto, preço válido e score mínimo de 90; a oferta não entra nos resultados normais antes da aprovação. Qualquer usuário pode validar ofertas e revisar, confirmar ou ignorar uma sugestão realmente detectada pelo motor. O restante dos cadastros continua restrito ao administrador.

## Aprendizado e compatibilidade

O catálogo aceita volume e gera tokens automaticamente. A API cria os termos de consulta usando os dados do produto e o aprendizado salvo, atribui score e status às ofertas e oferece feedback de confirmação ou descarte. Termos bons, aliases e palavras de exclusão são aprendidos pelo sistema, sem exigir cadastro manual.

As collections `sites` e `productlearnings` guardam, respectivamente, os sites monitorados e o aprendizado por produto. Nesta etapa, o cadastro de sites é a base de configuração; conectores específicos para executar a URL de busca de cada site serão adicionados separadamente.

No cadastro de sites, o usuário informa apenas `NOME`, `URL DE BUSCA` e `TIPO`. A URL base é derivada automaticamente, enquanto suporte a EAN/nome e necessidade de navegador automatizado permanecem como capacidades internas a serem descobertas pelo motor. O painel também oferece modelo e importação Excel de até 500 sites por arquivo.

As buscas regionalizadas usam o CEP padrão `06795-000`. A necessidade de preencher CEP é aprendida individualmente para cada site; o valor global pode ser alterado pela variável `SEARCH_POSTAL_CODE` sem editar os cadastros.
