const test = require('node:test');
const assert = require('node:assert/strict');

const { deduplicate, siteDomain, searchableSiteDomain } = require('../src/services/multiMarketplace');

test('remove rastreadores e consolida ofertas da mesma página', () => {
  const listings = deduplicate([
    { marketplace: 'Loja', title: 'Produto', price: 39.9, link: 'https://loja.example/produto?srsltid=abc' },
    { marketplace: 'Loja', title: 'Produto', price: 36.9, link: 'https://loja.example/produto?utm_source=google' }
  ]);
  assert.equal(listings.length, 1);
  assert.equal(listings[0].price, 36.9);
  assert.equal(listings[0].link, 'https://loja.example/produto');
});

test('ignora domínio incompatível com um marketplace conhecido', () => {
  assert.equal(searchableSiteDomain({ name: 'Mercado Livre', searchUrl: 'https://www.amazon.com.br/' }), '');
  assert.equal(searchableSiteDomain({ name: 'Amazon', searchUrl: 'https://www.amazon.com.br/' }), 'amazon.com.br');
});

test('extrai o domínio configurado do site para busca direcionada', () => {
  assert.equal(siteDomain({ searchUrl: 'https://www.soneda.com.br/busca?q={termo}' }), 'soneda.com.br');
  assert.equal(siteDomain({ searchUrl: 'inválida' }), '');
});
