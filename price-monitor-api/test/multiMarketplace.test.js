const test = require('node:test');
const assert = require('node:assert/strict');

const { deduplicate } = require('../src/services/multiMarketplace');

test('remove rastreadores e consolida ofertas da mesma página', () => {
  const listings = deduplicate([
    { marketplace: 'Loja', title: 'Produto', price: 39.9, link: 'https://loja.example/produto?srsltid=abc' },
    { marketplace: 'Loja', title: 'Produto', price: 36.9, link: 'https://loja.example/produto?utm_source=google' }
  ]);
  assert.equal(listings.length, 1);
  assert.equal(listings[0].price, 36.9);
  assert.equal(listings[0].link, 'https://loja.example/produto');
});
