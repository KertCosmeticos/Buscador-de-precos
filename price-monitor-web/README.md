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

## Cadastro e importação

Após entrar na aba **Cadastros**, o administrador pode cadastrar um produto pelo formulário ou importar arquivos Excel `.xls` e `.xlsx`. O botão **Baixar modelo** gera a estrutura esperada com as colunas `COD SFA`, `NOME`, `CODBARRAS`, `CATEGORIA` e `FAMILIA`.

A importação valida o arquivo antes do envio e exibe o progresso por lotes. Produtos são identificados pelo EAN: registros existentes são atualizados e registros novos são criados.

## Extensão Chrome

O modo **Chrome local** usa a extensão da pasta `price-monitor-chrome` para pesquisar Web e Shopping na sessão real do navegador. O painel detecta automaticamente a extensão, acompanha o progresso e mantém a API online como alternativa. A instalação detalhada está disponível no próprio painel.

O projeto não exige build nem dependências externas no frontend.
