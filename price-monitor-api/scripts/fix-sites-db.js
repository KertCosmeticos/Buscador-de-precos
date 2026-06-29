'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Site = require('../src/models/Site');

const URI = process.env.MONGODB_URI || process.argv[2];

async function fix(filter, update, label) {
  const r = await Site.updateMany(filter, { $set: update });
  const status = r.modifiedCount ? '  OK  ' : '  --  ';
  console.log(`${status}${label} (${r.modifiedCount} alterado(s))`);
  return r.modifiedCount;
}

async function main() {
  await mongoose.connect(URI);
  let total = 0;

  console.log('\n=== 1. Farmais: remove sellerId ===');
  total += await fix(
    { baseUrl: /farmais\.com\.br/i },
    { searchUrl: 'https://www.farmais.com.br/s/{termo}' },
    'Farmais searchUrl'
  );

  console.log('\n=== 2. Beleza na Web: requiresPlaywright + searchUrl correta ===');
  total += await fix(
    { name: 'Beleza na Web' },
    { requiresPlaywright: true, searchUrl: 'https://www.belezanaweb.com.br/pesquisa/?q={termo}' },
    'Beleza na Web'
  );

  console.log('\n=== 3. Desativar duplicatas e URLs quebradas ===');
  total += await fix({ name: 'Belezanaweb' },      { active: false }, 'Belezanaweb (duplicata — URL inválida)');
  total += await fix({ name: 'Akai Cosméticos' },  { active: false }, 'Akai Cosméticos (duplicata — URL 404)');
  total += await fix({ name: 'Beleza You' },       { active: false }, 'Beleza You (duplicata — URL com erro)');
  total += await fix({ name: 'Goyaperfumaria' },   { active: false }, 'Goyaperfumaria (duplicata — URL com erro)');
  total += await fix({ name: 'Shopee Brasil' },    { active: false }, 'Shopee Brasil (duplicata)');

  console.log('\n=== 4. Magazine Luiza: requiresPlaywright (bloqueia scraper) ===');
  total += await fix(
    { name: 'Magazine Luiza' },
    { requiresPlaywright: true },
    'Magazine Luiza'
  );

  console.log(`\nTotal de registros alterados: ${total}`);
  await mongoose.disconnect();
}

main().catch(e => { console.error('Erro:', e.message); process.exit(1); });
