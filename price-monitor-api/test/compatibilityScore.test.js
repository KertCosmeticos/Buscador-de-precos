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
  assert.equal(result.reasons.some(({ reason }) => /Palavra proibida/i.test(reason)), false);
});

test('rejeita MyPhios como marca concorrente', () => {
  const muitoLiso = {
    ean: '7896380660971',
    name: 'Keraton Sh Muito + Liso',
    family: 'Tratamento',
    volume: '300ml',
    searchTerm: 'keraton shampoo muito liso'
  };
  const result = calculateCompatibility(muitoLiso, {
    title: 'Shampoo MyPhios Muito Mais Liso Reducao de Frizz 300 ml',
    link: 'https://www.docebeleza.com.br/products/shampoo-myphios-muito-mais-liso-reducao-de-frizz-300-ml'
  });
  assert.equal(result.status, 'Ignorar');
  assert.ok(result.reasons.some(({ reason }) => /Marca concorrente/i.test(reason)));
});

test('classifica os intervalos definidos', () => {
  assert.equal(scoreStatus(90), 'Confirmado');
  assert.equal(scoreStatus(70), 'Provável');
  assert.equal(scoreStatus(40), 'Revisar');
  assert.equal(scoreStatus(39), 'Ignorar');
});
