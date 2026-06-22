# Extensão Chrome — Buscador de Preços Kert

A extensão consulta diretamente 70 lojas B2C autorizadas usando a sessão local do Chrome e devolve preço, loja e link direto ao painel do Buscador de Preços.

Em cada site, a extensão tenta o EAN e depois o nome oficial. O validador exige a cor ou nuance correta, aceita sinônimos do tipo (por exemplo, banho de brilho, tonalizante ou coloração) e rejeita marcas concorrentes conhecidas. Sem preço e link direto no cartão do produto, nada é incluído.

As lojas são consultadas com até quatro abas simultâneas. Como páginas podem mudar, exigir CEP/login ou bloquear automação, o cadastro central permite criar ajustes específicos sem voltar à busca genérica do Google.

## Instalação local

1. Abra `chrome://extensions/` no Chrome.
2. Ative **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação**.
4. Selecione a pasta `price-monitor-chrome` deste projeto.
5. Quando houver uma atualização, clique em **Recarregar** no cartão da extensão e depois atualize o painel.

A extensão não lê senhas nem histórico. Ela atua somente no painel publicado e nos 70 domínios cadastrados. A consulta usa até quatro abas e processa um produto por vez.
