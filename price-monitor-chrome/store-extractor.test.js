const test = require('node:test');
const assert = require('node:assert/strict');

const stores = require('./retail-stores');
const extractor = require('./store-extractor');
const manifest = require('./manifest.json');

test('cadastro de lojas não possui domínios duplicados', () => {
  assert.equal(new Set(stores.map((store) => store.host)).size, stores.length);
  assert.ok(stores.length >= 70);
});

test('todos os domínios cadastrados recebem o extrator da extensão', () => {
  const storeScript = manifest.content_scripts.find((entry) => entry.js.includes('store-extractor.js'));
  assert.ok(storeScript);
  for (const store of stores) {
    const covered = storeScript.matches.some((pattern) => {
      const patternHost = new URL(pattern.replace('*://', 'https://').replace('*.', '')).hostname;
      return store.host === patternHost || store.host.endsWith(`.${patternHost}`);
    });
    assert.ok(covered, `permissão ausente: ${store.host}`);
  }
});

test('extrai preço à vista e ignora frete antes do valor', () => {
  assert.equal(extractor.parseStorePrice('R$ 37,99 ou 2x sem juros'), 37.99);
  assert.equal(extractor.parseStorePrice('Frete R$ 12,00 Produto R$ 37,99'), 37.99);
});

test('não fabrica preço quando a página não exibe moeda', () => {
  assert.equal(extractor.parseStorePrice('Produto disponível - consulte condições'), null);
});
