# Status do projeto — Buscador de preços

Atualizado em 22/06/2026.

## Objetivo atual

Consultar preços atuais por EAN em diferentes marketplaces. O usuário pode localizar produtos por EAN, nome, categoria ou família e selecionar os itens do catálogo antes da consulta.

O sistema não armazena histórico de preços. O MongoDB guarda somente o catálogo de produtos da empresa.

## O que está pronto

### Frontend

- Interface responsiva em HTML, CSS e JavaScript puro.
- Abas Consulta, Catálogo de produtos e Cadastros.
- Catálogo público somente para visualização.
- Cadastros protegidos por login e senha.
- Filtros suspensos e multisseleção por produto, categoria e família.
- Seleção de todos os produtos filtrados.
- Resumo da consulta e detalhamento por marketplace.
- Exportação detalhada para CSV.
- Importação administrativa de planilhas `.xls` e `.xlsx`.
- Planilha-modelo gerada pelo painel, validação prévia e barra de progresso por lotes.
- Instruções de cadastro manual e importação dentro da aba Cadastros.
- Modo de pesquisa pelo Chrome local, sem consumo da SerpApi.
- Extensão Chrome 3.1 com consulta direta em 70 lojas B2C autorizadas e até quatro lojas simultâneas.
- Validador compartilhado que interpreta marca, tipo, linha, cor/variante e nuance numérica antes de aceitar uma oferta.
- Filtro B2C que exige preço, título e link no mesmo anúncio e exclui atacadistas, distribuidoras e portais para revendedores.
- Em cada loja: busca por EAN; sem oferta válida, busca por nome; sem preço, passa para a próxima loja.
- GitHub Pages publicado em:
  - https://kertcosmeticos.github.io/Buscador-de-precos/

### Backend

- Node.js, Express e MongoDB/Mongoose.
- Busca individual e em lote, com limite de cinco EANs simultâneos.
- Conector do Mercado Livre.
- Conector multiloja por Google Shopping/SerpApi.
- Busca alternativa pelo nome cadastrado quando o EAN não aparece no Google Shopping.
- Busca simultânea no Google Shopping e na Web, aproveitando ofertas que exibem preço em reais.
- Filtro de relevância por marca, linha e variação para remover produtos concorrentes.
- Até 30 resultados da Web por produto, com tentativa de extrair preço da página e exigir link direto do anúncio.
- Shopping consultado sempre por EAN e nome, com resolução de até cinco grupos de vendedores.
- Busca adicional direcionada a marketplaces, perfumarias e drogarias prioritários.
- Links diretos das ofertas quando disponibilizados pela fonte.
- CRUD do catálogo de produtos.
- Login administrativo com JWT e expiração de oito horas.
- Rotas de escrita protegidas no backend.
- Importação em lote protegida, com criação e atualização por EAN sem duplicidades.
- CORS configurável.
- Testes automatizados passando.
- Dockerfile preparado para o Koyeb.

### GitHub

- Repositório público:
  - https://github.com/KertCosmeticos/Buscador-de-precos
- Monorepo com `price-monitor-api` e `price-monitor-web`.
- Workflow do GitHub Pages funcionando.
- Arquivos `.env`, senhas e dependências locais não são versionados.

### MongoDB Atlas

- Banco do catálogo criado.
- Collection `products` criada.
- Usuário da aplicação criado.
- Acesso de rede para o Koyeb configurado.
- String de conexão obtida e guardada fora do repositório.

## Estado atual

O frontend está publicado no GitHub Pages e conectado à API em produção no Koyeb. O MongoDB Atlas, o Mercado Livre e o Google Shopping/SerpApi estão ativos.

A base oficial `PRODUTOS EM LINHA 2026 - BD.xlsx` foi validada e importada com 252 produtos, sem EANs ausentes, inválidos ou duplicados.

## Próximos passos

1. Recarregar a extensão 3.0 no Chrome e testar quais lojas exigem conector específico, CEP ou login.
2. Testar a reimportação de uma planilha para confirmar a atualização por EAN.
3. Acompanhar o consumo mensal de pesquisas no painel da SerpApi.

## Segurança

- Nunca colocar valores reais de credenciais no repositório ou em capturas de tela.
- Usar uma senha administrativa forte em produção.
- Gerar uma chave `JWT_SECRET` longa e aleatória.
- Trocar qualquer credencial que tenha sido exibida acidentalmente em uma captura.
- O modo demonstração deve permanecer desativado em produção.

## Execução local

O frontend local usa `http://127.0.0.1:5500/` e a API local usa `http://localhost:3000`.

Para a demonstração local, `DEMO_MODE=true` permite testar a interface sem consultar serviços externos. Produtos cadastrados nesse modo ficam apenas em memória.
