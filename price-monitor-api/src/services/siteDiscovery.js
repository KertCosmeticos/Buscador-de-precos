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

function buildCandidate(listing, domain) {
  return {
    domain,
    name: listing.marketplace && !/não informada/i.test(listing.marketplace) ? listing.marketplace : domain,
    searchUrl: `https://${domain}/`,
    type: inferredType(domain),
    evidenceTitle: listing.title,
    evidencePrice: listing.price,
    score: listing.score,
  };
}

async function splitDiscoveredListings(listings, sites, demoMode = false) {
  const regular = [];
  const byDomain = new Map();     // score >= 45: candidatos normais
  const weakByDomain = new Map(); // score 25-44: candidatos fracos (só para descoberta)

  listings.forEach((listing) => {
    const domain = hostname(listing.link);
    const isRegistered = domain && registeredDomain(domain, sites);
    const score = Number(listing.score);
    const isDiscovery = listing.discoveryCandidate === true && domain && !isRegistered
      && Number.isFinite(listing.price);

    if (isDiscovery && score >= 45) {
      const current = byDomain.get(domain);
      if (!current || score > current.candidate.score) {
        byDomain.set(domain, { candidate: buildCandidate(listing, domain), listing });
      }
      return;
    }

    if (isDiscovery && score >= 25) {
      const current = weakByDomain.get(domain);
      if (!current || score > current.score) {
        weakByDomain.set(domain, { ...buildCandidate(listing, domain), status: 'weak' });
      }
      // Candidato fraco não entra em regular — fica fora dos resultados de preço
      return;
    }

    if (!listing.discoveryCandidate || isRegistered) regular.push({ ...listing, sellerStatus: 'active' });
  });

  if (!demoMode) {
    // Salva candidatos normais (status: pending)
    if (byDomain.size) {
      const existing = await SiteCandidate.find({ domain: { $in: [...byDomain.keys()] } }).lean();
      existing.filter(({ status }) => status !== 'pending').forEach(({ domain }) => byDomain.delete(domain));
      const existingDomains = new Set(existing.map(({ domain }) => domain));
      const pending = [...byDomain.values()]
        .map(({ candidate }) => candidate)
        .filter(({ domain }) => !existingDomains.has(domain));
      if (pending.length) {
        await SiteCandidate.bulkWrite(pending.map((candidate) => ({
          updateOne: { filter: { domain: candidate.domain }, update: { $setOnInsert: { ...candidate, status: 'pending' } }, upsert: true },
        })), { ordered: false });
      }
    }

    // Salva candidatos fracos (status: weak) — só se o domínio ainda não existe
    if (weakByDomain.size) {
      const existing = await SiteCandidate.find({ domain: { $in: [...weakByDomain.keys()] } }).lean();
      const existingDomains = new Set(existing.map(({ domain }) => domain));
      const newWeak = [...weakByDomain.values()].filter((c) => !existingDomains.has(c.domain));
      if (newWeak.length) {
        await SiteCandidate.bulkWrite(newWeak.map((candidate) => ({
          updateOne: { filter: { domain: candidate.domain }, update: { $setOnInsert: candidate }, upsert: true },
        })), { ordered: false });
      }
    }
  }

  const discovered = [...byDomain.values()];
  const newListings = discovered.map(({ listing, candidate }) => ({
    ...listing,
    sellerStatus: 'new',
    siteCandidate: candidate,
    discoveryStatus: Number(listing.score) >= 70 ? 'aprovado' : 'revisar',
  }));

  return {
    listings: [...newListings, ...regular],
    discoveredSites: discovered.map(({ candidate }) => candidate),
    weakSites: [...weakByDomain.values()],
  };
}

module.exports = { hostname, inferredType, splitDiscoveredListings };
