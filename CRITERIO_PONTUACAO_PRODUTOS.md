# Critério de pontuação e validação de produtos

## Objetivo

Validar se uma oferta encontrada corresponde ao produto do catálogo antes de usá-la na comparação de preços.

O processo atual possui duas etapas:

1. **Validação eliminatória:** rejeita resultados incompatíveis.
2. **Pontuação de compatibilidade:** classifica os resultados aceitos conforme as evidências encontradas.

## 1. Validação eliminatória

| Critério | Regra atual | Resultado |
|---|---|---|
| Busca exata por EAN | A busca foi executada pelo EAN cadastrado | Aceita diretamente na validação semântica |
| Marca concorrente | O título ou a URL contém uma marca da lista de concorrentes | Rejeita |
| Kit, combo ou conjunto | O anúncio é um kit, mas o produto cadastrado é unitário | Rejeita |
| Nuance numérica | O produto possui nuance como `7.44` e ela não aparece no resultado | Rejeita |
| Cor ou variante | Todas as variantes obrigatórias do produto não aparecem no resultado | Rejeita |
| Tipo do produto | O resultado não corresponde ao tipo nem a um sinônimo aceito, como shampoo, condicionador, máscara ou tonalizante | Rejeita |
| Linha | Nenhum termo identificador da linha aparece no resultado | Rejeita |
| Identidade | Para produtos não relacionados a coloração, menos de 60% dos termos de identidade aparecem | Rejeita |
| URL descritiva | O caminho da URL indica concorrente, outra nuance ou não contém a variante obrigatória | Rejeita |

As palavras são normalizadas antes da comparação: letras minúsculas, remoção de acentos e sinais, exclusão de palavras genéricas e tolerância entre palavras de pelo menos seis letras com o mesmo prefixo inicial.

## 2. Pontuação de compatibilidade

### Pontos positivos

| Evidência | Pontos |
|---|---:|
| EAN encontrado no título, link, vendedor ou marketplace | +100 |
| Marca própria encontrada | +30 |
| Família/linha cadastrada encontrada | +25 |
| Volume/gramatura correta encontrada | +10 |
| Três primeiras palavras obrigatórias encontradas | +25 |

### Penalidades

| Incompatibilidade | Pontos |
|---|---:|
| Marca concorrente encontrada no título | -100 |
| Anúncio de kit/combo/conjunto para produto unitário | -40 |

### Fórmula

```text
Pontuação = soma das evidências positivas - penalidades
Resultado final limitado ao intervalo de -100 a 150 pontos
```

## 3. Classificação

| Faixa | Status | Interpretação sugerida |
|---:|---|---|
| 90 a 150 | Confirmado | Compatibilidade forte |
| 70 a 89 | Provável | Boa compatibilidade, com alguma evidência ausente |
| 40 a 69 | Revisar | Resultado duvidoso; requer conferência |
| -100 a 39 | Ignorar | Compatibilidade insuficiente |

## 4. Exemplo

Produto cadastrado: `Keraton Antiqueda 140 ml`.

Oferta: `Tônico Keraton Antiqueda 140 ml`.

| Evidência | Pontos |
|---|---:|
| Marca própria: Keraton | +30 |
| Linha/família: Antiqueda | +25 |
| Volume: 140 ml | +10 |
| Palavras obrigatórias | +25 |
| **Total** | **90 — Confirmado** |

Se a mesma oferta contiver o EAN correto, o total bruto será 190, mas a nota final ficará limitada a 150.

## 5. Uso atual da nota

- As ofertas são ordenadas da maior para a menor pontuação; em caso de empate, o menor preço aparece primeiro.
- Um novo site só vira candidato de descoberta quando a oferta possui preço e nota igual ou superior a 40.
- Para cadastrar automaticamente um site descoberto sem confirmação humana, a nota precisa ser igual ou superior a 90 e existir um preço de evidência.
- Atualmente, a API ainda inclui ofertas de qualquer faixa no resumo de preços. O status `Ignorar` classifica e ordena a oferta, mas não a remove automaticamente do cálculo.

## 6. Pontos de atenção

- A busca por EAN pula a validação semântica, mas isso indica apenas que a consulta foi feita pelo EAN; não garante que o EAN esteja escrito no anúncio.
- A penalidade de marca concorrente pode coexistir com pontos positivos. Portanto, dependendo das demais evidências, uma oferta concorrente ainda pode terminar acima do status `Ignorar`.
- O volume soma pontos quando está correto, mas um volume diferente não gera penalidade nem rejeição.
- As palavras obrigatórias só pontuam quando todas as três primeiras são encontradas; não existe pontuação parcial.
