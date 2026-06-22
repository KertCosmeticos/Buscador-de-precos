const test = require('node:test');
const assert = require('node:assert/strict');

const { googleWebOffersFromData } = require('../src/services/serpApi');

test('extrai ofertas com preço em reais dos resultados orgânicos', () => {
  const offers = googleWebOffersFromData({
    organic_results: [
      {
        title: 'Produto na Loja A',
        link: 'https://www.loja-a.com.br/produto',
        source: 'Loja A',
        snippet: 'Produto disponível por R$ 29,90. Frete calculado à parte.'
      },
      {
        title: 'Página sem preço',
        link: 'https://loja-b.com.br/produto',
        snippet: 'Consulte as condições no site.'
      }
    ]
  });

  assert.equal(offers.length, 1);
  assert.equal(offers[0].price, 29.9);
  assert.equal(offers[0].marketplace, 'Loja A');
  assert.equal(offers[0].link, 'https://www.loja-a.com.br/produto');
});
