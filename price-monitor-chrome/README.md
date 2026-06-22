# Extensão Chrome — Buscador de Preços Kert

A extensão pesquisa no Google Web, Shopping e Mercado Livre usando a sessão local do Chrome e devolve preço, loja e link direto ao painel do Buscador de Preços.

Cada produto passa por cinco etapas: EAN, nome oficial, consulta semântica por tipo/linha/variante, Shopping e Mercado Livre. A busca por EAN tem confiança direta. Nas demais, o validador exige a cor ou nuance correta, aceita sinônimos do tipo (por exemplo, banho de brilho, tonalizante ou coloração) e rejeita marcas concorrentes conhecidas.

## Instalação local

1. Abra `chrome://extensions/` no Chrome.
2. Ative **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação**.
4. Selecione a pasta `price-monitor-chrome` deste projeto.
5. Quando houver uma atualização, clique em **Recarregar** no cartão da extensão e depois atualize o painel.

A extensão não lê senhas nem histórico. Ela atua somente no painel publicado e em páginas de pesquisa do Google que ela própria abre. O Google pode solicitar CAPTCHA em pesquisas repetidas; nesse caso, resolva a verificação na aba aberta e repita a consulta.
