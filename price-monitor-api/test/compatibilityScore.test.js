const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateCompatibility, scoreStatus } = require('../src/services/compatibilityScore');

const product = {
  ean: '7896380660735', name: 'KERATON ANTIQUEDA', family: 'Antiqueda', volume: '140ml',
  searchTerm: 'keraton antiqueda', requiredWords: ['keraton', 'antiqueda'], forbiddenWords: ['shampoo']
};

test('pontua marca, linha, volume, palavras obrigatórias e preço', () => {
  const result = calculateCompatibility(product, { title: 'Tônico Keraton Antiqueda 140ml', price: 25.90 });
  // Marca +35, Linha +60, Volume +15, Palavras +20, Preço +10 = 140
  assert.equal(result.score, 140);
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

test('rejeita quando só tem marca e palavras ausentes', () => {
  // Marca +35, Linha ausente -20 cap, Palavras ausentes -30, Preço +10 = -5 → Rejeitado
  const simple = { name: 'KERATON ANTIQUEDA', family: 'Antiqueda', volume: '140ml', requiredWords: ['keraton', 'antiqueda'] };
  const result = calculateCompatibility(simple, { title: 'Keraton cosmeticos', price: 30 });
  assert.equal(result.status, 'Rejeitado');
});

test('Aprovado: marca e linha corretas sem volume', () => {
  const simple = { name: 'KERATON ANTIQUEDA', family: 'Antiqueda', volume: '140ml' };
  // Marca +35, Linha +60, Palavras +20, Preço +10 = 125 → Aprovado (sem volume no título)
  const result = calculateCompatibility(simple, { title: 'Keraton Antiqueda', price: 20 });
  assert.equal(result.status, 'Aprovado');
});

test('CandidatoFraco: shampoo da marca mas linha ausente e palavras incompletas', () => {
  const muitoLiso = {
    name: 'Keraton Sh Muito + Liso',
    family: 'Muito + Liso',
    volume: '300ml',
    requiredWords: ['keraton', 'shampoo', 'liso']
  };
  // Tipo +30, Marca +35, Linha ausente -20 cap, Volume +15, Palavras ausentes -30, Preço +10 = 40
  const result = calculateCompatibility(muitoLiso, {
    title: 'Shampoo Keraton 300ml',
    price: 22,
    link: 'https://newsite.com.br/shampoo-keraton-300ml'
  });
  assert.equal(result.status, 'CandidatoFraco');
  assert.ok(result.reasons.some(({ reason }) => /linha/i.test(reason)));
});

test('linha ausente cap limita a Revisar mesmo com score alto (caso Amazon sem lineBlockWords)', () => {
  // Produto sem lineBlockWords → cap mas não rejeita
  const muitoLiso = {
    name: 'Keraton Sh Muito + Liso',
    family: 'Muito + Liso',
    volume: '300ml',
    requiredWords: ['keraton', 'shampoo']
  };
  // Tipo +30, Marca +35, Linha ausente -20 cap, Volume +15, Palavras +20, Amazon não trusted +0, Preço +10 = 90 → capped 89
  const result = calculateCompatibility(muitoLiso, {
    title: 'Shampoo Hidratacao Keraton 300ml Preto',
    price: 35,
    link: 'https://www.amazon.com.br/dp/B09XYZ'
  });
  assert.equal(result.status, 'Revisar');
});

test('lineBlockWords rejeita linha interna bloqueada (Amazon errado)', () => {
  const muitoLiso = {
    name: 'Keraton Sh Muito + Liso',
    family: 'Muito + Liso',
    volume: '300ml',
    requiredWords: ['keraton', 'shampoo'],
    lineBlockWords: ['hidratacao', 'forca', 'preto']
  };
  const cases = [
    { title: 'Shampoo Hidratacao Keraton 300ml Preto', price: 35, link: 'https://www.amazon.com.br/dp/B1' },
    { title: 'Shampoo Forca Keraton 300ml Preto', price: 33, link: 'https://www.amazon.com.br/dp/B2' },
    { title: 'Keraton Shampoo Mais 300Ml Preto', price: 31, link: 'https://www.amazon.com.br/dp/B3' },
  ];
  cases.forEach((listing) => {
    const result = calculateCompatibility(muitoLiso, listing);
    assert.equal(result.status, 'Rejeitado', `deveria rejeitar: "${listing.title}"`);
    assert.ok(result.reasons.some(({ reason }) => /bloqueada/i.test(reason)));
  });
});

test('familyAliases ampliam detecção da linha', () => {
  const muitoLiso = {
    name: 'Keraton Sh Muito + Liso',
    family: 'Muito + Liso',
    familyAliases: ['phytogen muito liso', 'liso perfeito'],
    volume: '300ml',
    requiredWords: ['keraton', 'shampoo', 'liso']
  };
  // Linha encontrada via alias 'phytogen muito liso' → +60, sem cap
  const result = calculateCompatibility(muitoLiso, {
    title: 'Shampoo Phytogen Muito Liso 300ml Keraton',
    price: 29,
    link: 'https://goyaperfumaria.com.br/phytogen-muito-liso-shampoo-300ml'
  });
  assert.equal(result.status, 'Aprovado');
  assert.ok(result.reasons.some(({ points }) => points === 60));
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
