# Extensão Chrome — Buscador de Preços Kert

A extensão pesquisa no Google Web, Google Shopping e Mercado Livre usando a sessão local do Chrome e devolve preço, loja e link direto ao painel do Buscador de Preços.

Cada produto passa por cinco fontes: Google por EAN, Google por nome, Google semântico, Google Shopping e Mercado Livre. O validador exige a cor ou nuance correta, aceita sinônimos do tipo e rejeita marcas concorrentes conhecidas. Sem preço e link direto no anúncio, nada é incluído.

As pesquisas são feitas na internet sem abrir individualmente cada ecommerce. O Google pode solicitar CAPTCHA em consultas repetidas; nesse caso, a aba é apresentada para a verificação.

## Instalação local

1. Abra `chrome://extensions/` no Chrome.
2. Ative **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação**.
4. Selecione a pasta `price-monitor-chrome` deste projeto.
5. Quando houver uma atualização, clique em **Recarregar** no cartão da extensão e depois atualize o painel.

A extensão não lê senhas nem histórico. Ela atua somente no painel, no Google e no Mercado Livre, abrindo e fechando as abas de pesquisa automaticamente.
