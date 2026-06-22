const test = require('node:test');
const assert = require('node:assert/strict');

const extractor = require('./google-extractor');

test('não atribui preço a atalhos genéricos do Google', () => {
  assert.equal(extractor.isConsumerRetailOffer(
    'https://loja.example/produto', 'Resultados da Web', 'Resultados da Web R$ 37,99'
  ), false);
  assert.equal(extractor.isConsumerRetailOffer(
    'https://loja.example/produto', 'Vídeos', 'Vídeos R$ 37,99'
  ), false);
});

test('aceita uma página de produto em loja B2C', () => {
  assert.equal(extractor.isConsumerRetailOffer(
    'https://www.farmais.com.br/keraton-canela',
    'Coloração Banho de Brilho Cor Canela Keraton',
    'Coloração Banho de Brilho Cor Canela Keraton R$ 37,99 Comprar'
  ), true);
});

test('rejeita atacadistas, distribuidoras e portais para revendedores', () => {
  assert.equal(extractor.isConsumerRetailOffer(
    'https://liviadistribuidora.com.br/produto/keraton-canela',
    'Keraton Canela', 'R$ 37,99'
  ), false);
  assert.equal(extractor.isConsumerRetailOffer(
    'https://beleza-atacado.example/keraton-canela',
    'Keraton Canela', 'R$ 37,99'
  ), false);
  assert.equal(extractor.isConsumerRetailOffer(
    'https://loja.example/keraton-canela',
    'Keraton Canela', 'Venda exclusiva para lojistas R$ 37,99'
  ), false);
});

test('não troca preço do produto por parcela ou frete', () => {
  assert.equal(extractor.priceFromText('Produto R$ 37,99 em 2 parcelas'), 37.99);
  assert.equal(extractor.priceFromText('Frete R$ 12,00 Produto R$ 37,99'), 37.99);
});
