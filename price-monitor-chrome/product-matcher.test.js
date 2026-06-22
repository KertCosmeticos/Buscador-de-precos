const test = require('node:test');
const assert = require('node:assert/strict');

const matcher = require('./product-matcher');

const canela = {
  ean: '7896380600663',
  name: 'Keraton Banho de Brilho Canela',
  category: 'COLORAÇÃO TEMPORÁRIA',
  family: 'COLORAÇÃO'
};

test('EAN recebe confiança direta sem depender do nome do anúncio', () => {
  assert.equal(matcher.matchesOffer('Nome abreviado pelo fornecedor', '', { ...canela, searchMode: 'ean' }).relevant, true);
});

test('aceita sinônimos do tipo quando a cor obrigatória está presente', () => {
  assert.equal(matcher.matchesOffer('Tonalizante creme Canela 100g', 'https://loja.test/tonalizante-canela', canela).relevant, true);
  assert.equal(matcher.matchesOffer('Coloração temporária Canela Kert', 'https://loja.test/coloracao-canela', canela).relevant, true);
  assert.equal(matcher.matchesOffer('Banho de brilho Canela 100g', 'https://loja.test/banho-canela', canela).relevant, true);
});

test('rejeita outra cor, outro tipo e marca concorrente', () => {
  assert.equal(matcher.matchesOffer('Keraton Banho de Brilho Castanha', '', canela).relevant, false);
  assert.equal(matcher.matchesOffer('Keraton Selfie Canela', '', canela).relevant, false);
  assert.equal(matcher.matchesOffer("Tonalizante Canela L'Oréal", '', canela).relevant, false);
});

test('nuances numéricas diferenciam produtos da mesma linha', () => {
  const selfie = { name: 'Keraton Selfie 7.44 Louro Médio Cobre Intenso', category: 'COLORAÇÃO PERMANENTE KIT', family: 'COLORAÇÃO' };
  assert.equal(matcher.matchesOffer('Coloração Keraton Selfie 7.44 Cobre Intenso', '', selfie).relevant, true);
  assert.equal(matcher.matchesOffer('Coloração Keraton Selfie 7.4 Cobre', '', selfie).relevant, false);
});

test('tipo também separa shampoo, condicionador e máscara da mesma linha', () => {
  const shampoo = { name: 'Kert Phytogen Muito + Cachos Shampoo 300ml', category: 'TRATAMENTO', family: 'CACHOS' };
  assert.equal(matcher.matchesOffer('Shampoo Muito Cachos Phytogen 300ml', '', shampoo).relevant, true);
  assert.equal(matcher.matchesOffer('Condicionador Muito Cachos Phytogen 300ml', '', shampoo).relevant, false);
});

test('marca própria é um reforço, mas sua ausência não elimina a oferta', () => {
  assert.equal(matcher.matchesOffer('Tonalizante Canela 100g', '', canela).relevant, true);
  assert.equal(matcher.matchesOffer('Casting tonalizante Canela 100g', '', canela).relevant, false);
});

test('gera consulta semântica para o estudo de caso', () => {
  const query = matcher.buildSemanticQuery(canela);
  assert.match(query, /canela/i);
  assert.match(query, /tonalizante/i);
});
