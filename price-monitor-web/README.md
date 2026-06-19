# Price Monitor Web

Frontend estático em HTML, CSS e JavaScript para comparar ofertas atuais de múltiplos marketplaces por EAN. Os resultados não são armazenados.

## Configurar e executar

1. Abra `app.js` e troque a primeira linha pela URL real do backend:

   ```js
   const API_URL = 'https://seu-app.koyeb.app';
   ```

2. Sirva a pasta com qualquer servidor HTTP local (abrir o arquivo diretamente pode esbarrar em restrições do navegador):

   ```bash
   npx serve .
   ```

3. Acesse a URL exibida no terminal.

## Deploy no GitHub Pages

1. Publique esta pasta em um repositório chamado `price-monitor-web`.
2. No GitHub, acesse **Settings > Pages**.
3. Em **Build and deployment**, selecione **Deploy from a branch**, branch `main` e pasta `/ (root)`.
4. Salve e aguarde a URL `https://seu-usuario.github.io/price-monitor-web/`.
5. Configure essa origem em `CORS_ORIGINS` no backend. Exemplo: `https://seu-usuario.github.io`.

O projeto não exige build nem dependências externas no frontend.
