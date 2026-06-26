'use strict';

const axios = require('axios');
const { inspectProductPage } = require('./serpApi');

const bingClient = axios.create({
  baseURL: 'https://api.bing.microsoft.com',
  timeout: 12000,
});

function sellerFromUrl(url) {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

// Busca no Bing Web Search API com filtro opcional de domínios.
// Usa BING_API_KEY — plano gratuito: 1.000 calls/mês.
// Serve como alternativa ao Google quando o SerpAPI não está configurado
// ou como camada de descoberta independente.
async function searchBingWeb(term, domains = []) {
  if (!process.env.BING_API_KEY || !term) return [];
  try {
    const query = domains.length
      ? `${term} (${domains.slice(0, 6).map((d) => `site:${d}`).join(' OR ')})`
      : term;
    const { data } = await bingClient.get('/v7.0/search', {
      params: { q: query, mkt: 'pt-BR', count: 20, responseFilter: 'Webpages' },
      headers: { 'Ocp-Apim-Subscription-Key': process.env.BING_API_KEY },
    });
    const pages = (data.webPages?.value || [])
      .map((r) => ({
        title: r.name || '',
        price: null,
        link: r.url || '',
        seller: sellerFromUrl(r.url),
        marketplace: sellerFromUrl(r.url),
        condition: 'new',
        freeShipping: false,
      }))
      .filter((r) => r.link);

    const resolved = await Promise.allSettled(
      pages.map(async (r) => {
        const page = await inspectProductPage(r.link);
        if (!page || !Number.isFinite(page.price)) return null;
        return { ...r, price: page.price, link: page.directLink || r.link, title: page.title || r.title };
      })
    );
    return resolved.filter((r) => r.status === 'fulfilled' && r.value).map((r) => r.value);
  } catch { return []; }
}

module.exports = { searchBingWeb };
