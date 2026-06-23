const SiteCandidate = require('../models/SiteCandidate');

function hostname(value) {
  try { return new URL(value).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

function registeredDomain(domain, sites) {
  return sites.some((site) => {
    const known = hostname(site.searchUrl || site.baseUrl);
    return known && (domain === known || domain.endsWith(`.${known}`) || known.endsWith(`.${domain}`));
  });
}

function inferredType(domain) {
  if (/(amazon|mercadolivre|shopee|magazineluiza)/i.test(domain)) return 'marketplace';
  if (/(drog|farm)/i.test(domain)) return 'drogaria';
  return 'perfumaria';
}

async function splitDiscoveredListings(listings, sites, demoMode = false) {
  const regular = [];
  const byDomain = new Map();
  listings.forEach((listing) => {
    const domain = hostname(listing.link);
    const candidate = listing.discoveryCandidate === true && domain && !registeredDomain(domain, sites)
      && Number.isFinite(listing.price) && Number(listing.score) >= 90;
    if (!candidate) {
      if (!listing.discoveryCandidate) regular.push(listing);
      return;
    }
    const current = byDomain.get(domain);
    if (!current || listing.score > current.score) {
      byDomain.set(domain, {
        domain,
        name: listing.marketplace && !/não informada/i.test(listing.marketplace) ? listing.marketplace : domain,
        searchUrl: `https://${domain}/`,
        type: inferredType(domain),
        evidenceTitle: listing.title,
        evidencePrice: listing.price,
        score: listing.score
      });
    }
  });
  if (!demoMode && byDomain.size) {
    const existing = await SiteCandidate.find({ domain: { $in: [...byDomain.keys()] } }).lean();
    existing.filter(({ status }) => status !== 'pending').forEach(({ domain }) => byDomain.delete(domain));
    const existingDomains = new Set(existing.map(({ domain }) => domain));
    const pending = [...byDomain.values()].filter(({ domain }) => !existingDomains.has(domain));
    if (pending.length) {
      await SiteCandidate.bulkWrite(pending.map((candidate) => ({
        updateOne: { filter: { domain: candidate.domain }, update: { $setOnInsert: { ...candidate, status: 'pending' } }, upsert: true }
      })), { ordered: false });
    }
  }
  return { listings: regular, discoveredSites: [...byDomain.values()] };
}

module.exports = { hostname, inferredType, splitDiscoveredListings };
