const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DEMO_MODE = 'true';

const catalog = require('../src/services/productCatalog');

const product = {
  ean: '12345678',
  sku: 'SFA-TESTE',
  name: 'Produto de teste',
  category: 'Categoria teste',
  family: 'Família teste',
  active: true
};

test('importação cria, mantém e atualiza produtos pelo EAN', async () => {
  const created = await catalog.importProducts([product]);
  assert.deepEqual(created, { total: 1, created: 1, updated: 0, unchanged: 0 });

  const unchanged = await catalog.importProducts([product]);
  assert.deepEqual(unchanged, { total: 1, created: 0, updated: 0, unchanged: 1 });

  const updated = await catalog.importProducts([{ ...product, name: 'Produto atualizado' }]);
  assert.deepEqual(updated, { total: 1, created: 0, updated: 1, unchanged: 0 });

  const found = await catalog.getProductByEan(product.ean);
  assert.equal(found.name, 'Produto atualizado');
});
