const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateCompatibility, scoreStatus } = require('../src/services/compatibilityScore');

const product = {
  ean: '7896380660735', name: 'KERATON ANTIQUEDA', family: 'Antiqueda', volume: '140ml',
  searchTerm: 'keraton antiqueda', requiredWords: ['keraton', 'antiqueda'], forbiddenWords: ['shampoo']
};

test('pontua marca, linha, volume e palavras obrigatórias', () => {
  const result = calculateCompatibility(product, { title: 'Tônico Keraton Antiqueda 140ml' });
  assert.equal(result.score, 90);
  assert.equal(result.status, 'Confirmado');
});

test('penaliza kit, palavra proibida e título já rejeitado', () => {
  const listing = { title: 'Kit Shampoo Keraton Antiqueda 140ml' };
  const result = calculateCompatibility(product, listing, { ignoredTitles: [listing.title] });
  assert.equal(result.status, 'Ignorar');
  assert.ok(result.reasons.some(({ reason }) => reason === 'Produto em kit'));
});

test('classifica os intervalos definidos', () => {
  assert.equal(scoreStatus(90), 'Confirmado');
  assert.equal(scoreStatus(70), 'Provável');
  assert.equal(scoreStatus(40), 'Revisar');
  assert.equal(scoreStatus(39), 'Ignorar');
});
