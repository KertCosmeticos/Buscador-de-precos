# Price Monitor API

Backend Node.js/Express que pesquisa EANs em múltiplas fontes em tempo real. A busca combina um conector direto do Mercado Livre com uma varredura de lojas indexadas no Google Shopping via SerpApi. O MongoDB armazena somente o catálogo de produtos da empresa; resultados e preços não são armazenados.

## Executar localmente

Requer Node.js 18+ e MongoDB para o catálogo em produção.

```bash
npm install
cp .env.example .env
npm start
```

No Windows, copie `.env.example` para `.env` manualmente. Configure `SERPAPI_KEY` e, se quiser restringir o CORS, informe uma ou mais origens em `CORS_ORIGINS`, separadas por vírgula. Se essa variável ficar vazia, todas as origens serão aceitas.

Para uma demonstração local sem banco e sem chamadas externas, use `DEMO_MODE=true`. Nunca ative esse modo em produção. Para a varredura real multiloja, crie uma chave na SerpApi e configure `SERPAPI_KEY`.

Na busca real, a API consulta os vendedores do produto e retorna o `direct_link` da oferta. Assim, o link abre a página final do produto na loja, sem passar pela página intermediária do Google Shopping. Como essa resolução exige consultas adicionais, acompanhe o consumo de créditos da SerpApi.

## Endpoints

- `GET /health`
- `GET /buscar?ean=789...`
- `POST /buscar/lote` com body `[“789...”, “790...”]` (máximo 100; até 5 buscas simultâneas)
- `GET /produtos?search=&category=&family=`
- `GET /produtos/filtros`
- `POST /auth/login`
- `GET /auth/me` (autenticado)
- `POST /produtos` (administrador)
- `PUT /produtos/:id` (administrador)
- `DELETE /produtos/:id` (administrador)

## Deploy no Koyeb

1. Publique esta pasta em um repositório chamado `price-monitor-api`.
2. No Koyeb, crie um **Web Service** a partir do repositório GitHub.
3. Se o repositório contiver somente este projeto, use o diretório raiz. O comando de execução é `npm start` (também declarado no `Procfile`).
4. Adicione `MONGODB_URI`, `SERPAPI_KEY`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `JWT_SECRET` e, opcionalmente, `CORS_ORIGINS` nas variáveis do serviço. Use uma senha forte e uma chave JWT longa e aleatória. O Koyeb fornece `PORT` automaticamente.
5. No MongoDB Atlas, crie o banco e libere o acesso de rede para o Koyeb.
6. Depois do deploy, teste `https://seu-app.koyeb.app/health`.

Não versione o arquivo `.env`.
