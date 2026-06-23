const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateCompatibility, scoreStatus } = require('../src/services/compatibilityScore');

const product = {
  ean: '7896380660735', name: 'KERATON ANTIQUEDA', family: 'Antiqueda', volume: '140ml',
  tokens: ['keraton', 'antiqueda']
};

test('pontua marca, linha, volume e palavras obrigatórias', () => {
  const result = calculateCompatibility(product, { title: 'Tônico Keraton Antiqueda 140ml' });
  assert.equal(result.score, 90);
  assert.equal(result.status, 'Confirmado');
});

test('penaliza kit, palavra proibida e título rejeitado somente no site', () => {
  const listing = { title: 'Kit Shampoo Keraton Antiqueda 140ml', link: 'https://loja-a.test/produto' };
  const result = calculateCompatibility(product, listing, { siteRejections: [{ domain: 'loja-a.test', title: listing.title }], excludedWords: ['shampoo'] });
  assert.equal(result.status, 'Ignorar');
  assert.ok(result.reasons.some(({ reason }) => reason === 'Produto em kit'));
});

test('classifica os intervalos definidos', () => {
  assert.equal(scoreStatus(90), 'Confirmado');
  assert.equal(scoreStatus(70), 'Provável');
  assert.equal(scoreStatus(40), 'Revisar');
  assert.equal(scoreStatus(39), 'Ignorar');
});

test('rejeição de título não afeta o mesmo retorno em outro site', () => {
  const title = 'Tônico Keraton Antiqueda 140ml';
  const learning = { siteRejections: [{ domain: 'loja-a.test', title }] };
  const rejected = calculateCompatibility(product, { title, link: 'https://loja-a.test/produto' }, learning);
  const accepted = calculateCompatibility(product, { title, link: 'https://loja-b.test/produto' }, learning);
  assert.equal(rejected.rejectedByLearning, true);
  assert.equal(accepted.rejectedByLearning, false);
});
