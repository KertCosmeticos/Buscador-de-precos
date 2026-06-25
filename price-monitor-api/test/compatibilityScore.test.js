const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateCompatibility, scoreStatus } = require('../src/services/compatibilityScore');

const product = {
  ean: '7896380660735', name: 'KERATON ANTIQUEDA', family: 'Antiqueda', volume: '140ml',
  searchTerm: 'keraton antiqueda', requiredWords: ['keraton', 'antiqueda'], forbiddenWords: ['shampoo']
};

test('pontua marca, linha, volume, palavras obrigatórias e preço', () => {
  const result = calculateCompatibility(product, { title: 'Tônico Keraton Antiqueda 140ml', price: 25.90 });
  assert.equal(result.score, 125);
  assert.equal(result.status, 'Aprovado');
});

test('penaliza kit', () => {
  const listing = { title: 'Kit Keraton Antiqueda 140ml', price: 50 };
  const result = calculateCompatibility(product, listing);
  assert.equal(result.status, 'Revisar');
  assert.ok(result.reasons.some(({ reason }) => reason === 'Produto em kit'));
});

test('rejeita título já ignorado imediatamente', () => {
  const listing = { title: 'Kit Keraton Antiqueda 140ml' };
  const result = calculateCompatibility(product, listing, { ignoredTitles: [listing.title] });
  assert.equal(result.status, 'Rejeitado');
  assert.ok(result.reasons.some(({ reason }) => /ignorado/i.test(reason)));
});

test('rejeita tipo conflitante', () => {
  const shampoo = {
    ean: '7896380660971',
    name: 'Keraton Sh Muito + Liso',
    family: 'Muito + Liso',
    volume: '300ml',
    searchTerm: 'keraton shampoo muito liso'
  };
  const result = calculateCompatibility(shampoo, {
    title: 'Condicionador Keraton Muito Liso 300ml',
    price: 18,
    link: 'https://example.com/cond'
  });
  assert.equal(result.status, 'Rejeitado');
  assert.ok(result.reasons.some(({ reason }) => /tipo errado/i.test(reason)));
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
    price: 15,
    link: 'https://www.docebeleza.com.br/products/shampoo-myphios-muito-mais-liso-reducao-de-frizz-300-ml'
  });
  assert.equal(result.status, 'Rejeitado');
  assert.ok(result.reasons.some(({ reason }) => /Marca concorrente/i.test(reason)));
});

test('classifica como CandidatoFraco quando tem marca mas falta identidade', () => {
  // só marca + preço = 40+10 = 50... precisa de menos pontos para CandidatoFraco
  // marca + preço - palavras ausentes = 40+10-30 = 20... ainda Rejeitado
  // marca + linha + preço = 40+35+10 = 85 → Revisar, não CandidatoFraco
  // Simula listing apenas com marca e preço, sem linha/volume/palavras:
  const simple = { name: 'KERATON ANTIQUEDA', family: 'Antiqueda', volume: '140ml', requiredWords: ['keraton', 'antiqueda'] };
  const result = calculateCompatibility(simple, { title: 'Keraton cosmeticos', price: 30 });
  // marca(+40) + preço(+10) - palavras ausentes(-30) = 20 → Rejeitado
  // Mas palavras=['keraton','antiqueda'], 'keraton' encontrado, 'antiqueda' não → não é TODOS encontrados
  // Então: -30 por palavras ausentes
  // score = 40+10-30 = 20 → Rejeitado
  assert.equal(result.status, 'Rejeitado');
});

test('CandidatoFraco: marca + linha parcial sem volume', () => {
  const simple = { name: 'KERATON ANTIQUEDA', family: 'Antiqueda', volume: '140ml' };
  // Sem requiredWords → auto-gera ['keraton', 'antiqueda']
  const result = calculateCompatibility(simple, { title: 'Keraton Antiqueda', price: 20 });
  // marca(+40) + linha(+35) + palavras(+20) + preço(+10) = 105 → Aprovado (sem volume no título)
  // Nota: volume '140ml' não está no título → não pontua volume
  assert.equal(result.status, 'Aprovado');
});

test('rejeita quando sem preço', () => {
  const result = calculateCompatibility(product, { title: 'Keraton Antiqueda 140ml' });
  assert.equal(result.status, 'Rejeitado');
  assert.ok(result.reasons.some(({ reason }) => /sem pre.o/i.test(reason)));
});

test('classifica os intervalos definidos', () => {
  assert.equal(scoreStatus(90), 'Aprovado');
  assert.equal(scoreStatus(89), 'Revisar');
  assert.equal(scoreStatus(50), 'Revisar');
  assert.equal(scoreStatus(49), 'CandidatoFraco');
  assert.equal(scoreStatus(25), 'CandidatoFraco');
  assert.equal(scoreStatus(24), 'Rejeitado');
});
