const test = require('node:test');
const assert = require('node:assert/strict');
const { splitDiscoveredListings } = require('../src/services/siteDiscovery');

test('sugere somente domínio novo com oferta confirmada', async () => {
  const sites = [{ searchUrl: 'https://loja-cadastrada.test/' }];
  const input = [
    { title: 'Keraton', link: 'https://loja-cadastrada.test/produto', price: 20, score: 100 },
    { title: 'Keraton correto', link: 'https://nova-loja.test/produto', price: 25, score: 95, marketplace: 'Nova Loja', discoveryCandidate: true },
    { title: 'Keraton duvidoso', link: 'https://outra.test/produto', price: 22, score: 60, discoveryCandidate: true }
  ];
  const result = await splitDiscoveredListings(input, sites, true);
  assert.equal(result.listings.length, 1);
  assert.equal(result.discoveredSites.length, 1);
  assert.equal(result.discoveredSites[0].domain, 'nova-loja.test');
});

test('não exibe oferta descoberta na tabela antes da confirmação', async () => {
  const result = await splitDiscoveredListings([
    { title: 'Keraton', link: 'https://nova.test/produto', price: 25, score: 95, discoveryCandidate: true }
  ], [], true);
  assert.deepEqual(result.listings, []);
});
