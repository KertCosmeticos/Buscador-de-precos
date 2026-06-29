'use strict';

/**
 * Migração: corrige configuração de Farmais e Beleza na Web no banco de dados.
 *
 * Farmais     — remove ?sellerId=farmaisirati059 da searchUrl
 * Beleza na Web — corrige searchUrl e ativa requiresPlaywright
 *
 * Uso: node price-monitor-api/scripts/update-sites.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Site = require('../src/models/Site');

async function main() {
  if (process.env.DEMO_MODE === 'true') {
    console.log('DEMO_MODE ativo — banco não utilizado.');
    console.log('\nAtualize manualmente pela interface:');
    console.log('  Farmais     : remova "?sellerId=farmaisirati059" da searchUrl');
    console.log('  Beleza na Web: searchUrl = https://www.belezanaweb.com.br/pesquisa/?q={termo}');
    console.log('               : requiresPlaywright = true');
    return;
  }

  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI não configurada no .env');
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Conectado ao MongoDB.\n');

  // Farmais: remove sellerId da searchUrl
  const farmais = await Site.findOne({ baseUrl: /farmais\.com\.br/i });
  if (farmais) {
    const original = farmais.searchUrl;
    const fixed = original
      .replace(/[?&]sellerId=[^&#]*/i, '')
      .replace(/\?(&|$)/, '?')
      .replace(/[?&]$/, '');
    if (fixed !== original) {
      await Site.updateOne({ _id: farmais._id }, { $set: { searchUrl: fixed } });
      console.log(`Farmais atualizado:`);
      console.log(`  antes : ${original}`);
      console.log(`  depois: ${fixed}`);
    } else {
      console.log('Farmais: searchUrl já está correta, nada a alterar.');
    }
  } else {
    console.log('Farmais: site não encontrado no banco.');
  }

  // Beleza na Web: corrige searchUrl + ativa requiresPlaywright
  const beleza = await Site.findOne({ baseUrl: /belezanaweb\.com\.br/i });
  if (beleza) {
    const newSearchUrl = 'https://www.belezanaweb.com.br/pesquisa/?q={termo}';
    await Site.updateOne(
      { _id: beleza._id },
      { $set: { searchUrl: newSearchUrl, requiresPlaywright: true } }
    );
    console.log(`\nBeleza na Web atualizada:`);
    console.log(`  searchUrl        : ${newSearchUrl}`);
    console.log(`  requiresPlaywright: true`);
  } else {
    console.log('\nBeleza na Web: site não encontrado no banco.');
  }

  await mongoose.disconnect();
  console.log('\nMigração concluída.');
}

main().catch((err) => {
  console.error('Erro:', err.message);
  process.exit(1);
});
