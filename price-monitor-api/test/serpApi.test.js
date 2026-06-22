const test = require('node:test');
const assert = require('node:assert/strict');

const { googleWebOffersFromData, isRelevantOffer, productPageDataFromHtml } = require('../src/services/serpApi');

test('extrai ofertas com preço em reais dos resultados orgânicos', () => {
  const offers = googleWebOffersFromData({
    organic_results: [
      {
        title: 'Keraton Banho de Brilho Canela 100g',
        link: 'https://www.loja-a.com.br/produto',
        source: 'Loja A',
        snippet: 'Produto disponível. Frete calculado à parte.',
        rich_snippet: { top: { detected_extensions: { price: 29.9 } } }
      },
      {
        title: 'Keraton Banho de Brilho Canela na Loja B',
        link: 'https://loja-b.com.br/produto',
        snippet: 'Consulte as condições no site.'
      }
    ]
  }, 'Keraton Banho de Brilho Canela');

  assert.equal(offers.length, 2);
  assert.equal(offers[0].price, 29.9);
  assert.equal(offers[0].marketplace, 'Loja A');
  assert.equal(offers[0].link, 'https://www.loja-a.com.br/produto');
  assert.equal(offers[1].price, null);
  assert.equal(offers[1].marketplace, 'loja-b.com.br');
});

test('rejeita marcas concorrentes e variações incorretas', () => {
  assert.equal(isRelevantOffer('Keraton Banho de Brilho Canela 100g', 'Keraton Banho de Brilho Canela'), true);
  assert.equal(isRelevantOffer('Tonalizante Keraton Banho de Brilho Castanho Natural', 'Keraton Banho de Brilho Castanha'), true);
  assert.equal(isRelevantOffer('Tonalizante Color Intense Caribe', 'Keraton Banho de Brilho Castanha'), false);
  assert.equal(isRelevantOffer("Tintura Casting Creme Gloss L'Oréal", 'Keraton Banho de Brilho Castanha'), false);
  assert.equal(isRelevantOffer('Keraton Banho de Brilho Canela', 'Keraton Banho de Brilho Castanha'), false);
});

test('extrai preço e link direto do JSON-LD da página do produto', () => {
  const html = `
    <html><head>
      <script type="application/ld+json">
        {"@type":"Product","name":"Keraton Canela","url":"/produto/keraton-canela","offers":{"@type":"Offer","price":"43.90","priceCurrency":"BRL"}}
      </script>
    </head></html>`;
  const page = productPageDataFromHtml(html, 'https://loja.example/categoria');
  assert.deepEqual(page, {
    price: 43.9,
    directLink: 'https://loja.example/produto/keraton-canela',
    isProductPage: true
  });
});

test('aproveita produtos patrocinados da busca web', () => {
  const offers = googleWebOffersFromData({
    shopping_results: [{
      title: 'Keraton Tonalizante Banho de Brilho Canela 100g',
      source: 'Amazon.com.br',
      extracted_price: 47.82,
      link: 'https://www.amazon.com.br/dp/EXEMPLO'
    }]
  }, 'Keraton Banho de Brilho Canela');
  assert.equal(offers.length, 1);
  assert.equal(offers[0].price, 47.82);
  assert.equal(offers[0].marketplace, 'Amazon.com.br');
});
