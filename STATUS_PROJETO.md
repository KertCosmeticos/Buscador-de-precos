# Status do projeto — Buscador de preços

Atualizado em 19/06/2026.

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
- GitHub Pages publicado em:
  - https://kertcosmeticos.github.io/Buscador-de-precos/

### Backend

- Node.js, Express e MongoDB/Mongoose.
- Busca individual e em lote, com limite de cinco EANs simultâneos.
- Conector do Mercado Livre.
- Conector multiloja por Google Shopping/SerpApi.
- Links diretos das ofertas quando disponibilizados pela fonte.
- CRUD do catálogo de produtos.
- Login administrativo com JWT e expiração de oito horas.
- Rotas de escrita protegidas no backend.
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

O frontend está online, mas ainda não está conectado ao backend. Ele mostra uma mensagem amigável informando que a API aguarda configuração.

O serviço da API ainda não foi criado no Koyeb. A conta/chave da SerpApi também ainda precisa ser concluída.

## Próximos passos

1. Criar ou acessar a conta da SerpApi.
2. Obter a chave `SERPAPI_KEY` sem colocá-la no GitHub.
3. Criar um Web Service no Koyeb a partir deste repositório.
4. Configurar no Koyeb:
   - `MONGODB_URI`
   - `SERPAPI_KEY`
   - `ADMIN_USERNAME`
   - `ADMIN_PASSWORD`
   - `JWT_SECRET`
   - `DEMO_MODE=false`
   - `CORS_ORIGINS=https://kertcosmeticos.github.io`
5. Fazer o deploy e testar `/health` na URL do Koyeb.
6. No GitHub, criar a variável de repositório `API_URL` com a URL do Koyeb.
7. Executar novamente o workflow do GitHub Pages.
8. Testar cadastro, login, consulta real, links e exportação CSV.

## Segurança

- Nunca colocar valores reais de credenciais no repositório ou em capturas de tela.
- Usar uma senha administrativa forte em produção.
- Gerar uma chave `JWT_SECRET` longa e aleatória.
- Trocar qualquer credencial que tenha sido exibida acidentalmente em uma captura.
- O modo demonstração deve permanecer desativado em produção.

## Execução local

O frontend local usa `http://127.0.0.1:5500/` e a API local usa `http://localhost:3000`.

Para a demonstração local, `DEMO_MODE=true` permite testar a interface sem consultar serviços externos. Produtos cadastrados nesse modo ficam apenas em memória.
