const test = require('node:test');
const assert = require('node:assert/strict');

const { googleWebOffersFromData, isRelevantOffer } = require('../src/services/serpApi');

test('extrai ofertas com preço em reais dos resultados orgânicos', () => {
  const offers = googleWebOffersFromData({
    organic_results: [
      {
        title: 'Keraton Banho de Brilho Canela 100g',
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
  }, 'Keraton Banho de Brilho Canela');

  assert.equal(offers.length, 1);
  assert.equal(offers[0].price, 29.9);
  assert.equal(offers[0].marketplace, 'Loja A');
  assert.equal(offers[0].link, 'https://www.loja-a.com.br/produto');
});

test('rejeita marcas concorrentes e variações incorretas', () => {
  assert.equal(isRelevantOffer('Keraton Banho de Brilho Canela 100g', 'Keraton Banho de Brilho Canela'), true);
  assert.equal(isRelevantOffer('Tonalizante Keraton Banho de Brilho Castanho Natural', 'Keraton Banho de Brilho Castanha'), true);
  assert.equal(isRelevantOffer('Tonalizante Color Intense Caribe', 'Keraton Banho de Brilho Castanha'), false);
  assert.equal(isRelevantOffer("Tintura Casting Creme Gloss L'Oréal", 'Keraton Banho de Brilho Castanha'), false);
  assert.equal(isRelevantOffer('Keraton Banho de Brilho Canela', 'Keraton Banho de Brilho Castanha'), false);
});
