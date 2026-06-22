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

As colunas aceitas são `COD SFA`, `NOME`, `CODBARRAS`, `CATEGORIA` e `FAMILIA`. O EAN identifica cada produto: um EAN novo é cadastrado e um EAN existente é atualizado, sem criar duplicidades.

## Pesquisa pelo Chrome

A pasta `price-monitor-chrome` contém uma extensão Manifest V3 que consulta diretamente uma lista controlada de lojas B2C usando a sessão local do navegador, sem consumir SerpApi. O workflow do Pages publica também `price-monitor-chrome.zip`, disponível no próprio painel.

Em cada loja, a extensão pesquisa primeiro o EAN e, se não encontrar uma oferta válida, tenta o nome oficial. O resultado só é aceito quando nome compatível, preço em reais e link direto pertencem ao mesmo cartão de produto. Cor/nuance e tipo compatível são obrigatórios. A extensão abre uma loja por vez em segundo plano e fecha a aba ao terminar; sites com CAPTCHA, exigência de CEP, login ou bloqueio podem ficar sem resultado até receberem um conector específico.
