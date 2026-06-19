const IS_LOCAL = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const API_URL = IS_LOCAL
  ? 'http://localhost:3000'
  : 'https://sua-api.koyeb.app';

let currentResults = [];
let adminToken = sessionStorage.getItem('priceMonitorAdminToken') || '';
let allCatalogProducts = [];
let catalogProducts = [];
const selectedProductEans = new Set();
const selectedNames = new Set();
const selectedCategories = new Set();
const selectedFamilies = new Set();

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const byId = (id) => document.getElementById(id);

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((item) => {
      const active = item === tab;
      item.classList.toggle('active', active);
      item.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('.panel').forEach((panel) => {
      const active = panel.id === `${tab.dataset.tab}-panel`;
      panel.classList.toggle('active', active);
      panel.hidden = !active;
    });
  });
});

async function loadApiMode() {
  const badge = byId('data-mode');
  try {
    const health = await request('/health');
    const real = health.mode === 'real';
    badge.textContent = real ? 'Dados reais' : 'Modo demonstração';
    badge.className = `mode-badge ${real ? 'real' : 'demo'}`;
    byId('demo-login-hint').hidden = real;
  } catch {
    badge.textContent = 'API desconectada';
    badge.className = 'mode-badge';
  }
}

function setMessage(element, text = '', type = '') {
  element.textContent = text;
  element.className = `message ${type}`.trim();
}

function setLoading(button, loading) {
  button.disabled = loading;
  button.classList.toggle('loading', loading);
}

async function request(path, options = {}) {
  if (!IS_LOCAL && API_URL.includes('sua-api.koyeb.app')) {
    throw new Error('A API ainda não foi conectada. Finalize a configuração do backend no Koyeb.');
  }
  const headers = new Headers(options.headers || {});
  if (adminToken) headers.set('Authorization', `Bearer ${adminToken}`);
  let response;
  try {
    response = await fetch(`${API_URL}${path}`, { ...options, headers });
  } catch {
    throw new Error('Não foi possível conectar à API. Verifique se o backend está disponível.');
  }
  let data;
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) {
    const error = new Error(data.error || 'Não foi possível concluir a solicitação.');
    error.status = response.status;
    if (response.status === 401 && path !== '/auth/login' && adminToken) setAdminAccess(false);
    throw error;
  }
  return data;
}

function setAdminAccess(authenticated) {
  byId('restricted-login').hidden = authenticated;
  byId('admin-content').hidden = !authenticated;
  if (!authenticated) {
    adminToken = '';
    sessionStorage.removeItem('priceMonitorAdminToken');
    resetProductForm();
  }
}

async function restoreAdminSession() {
  if (!adminToken) return setAdminAccess(false);
  try {
    await request('/auth/me');
    setAdminAccess(true);
  } catch {
    setAdminAccess(false);
  }
}

const filterDefinitions = {
  name: { property: 'name', input: 'name-filter-search', options: 'name-filter-options', selected: selectedNames },
  category: { property: 'category', input: 'category-filter-search', options: 'category-filter-options', selected: selectedCategories },
  family: { property: 'family', input: 'family-filter-search', options: 'family-filter-options', selected: selectedFamilies }
};

function updateFilterPlaceholder(definition) {
  const input = byId(definition.input);
  input.placeholder = definition.selected.size
    ? `${definition.selected.size} opção(ões) selecionada(s)`
    : 'Clique para selecionar';
}

function closeFilterMenus(except = null) {
  Object.entries(filterDefinitions).forEach(([type, definition]) => {
    if (type === except) return;
    const input = byId(definition.input);
    input.closest('.filter-field').classList.remove('open');
    if (input.value) {
      input.value = '';
      renderFilterOptions(type);
    }
  });
}

function renderFilterOptions(type) {
  const definition = filterDefinitions[type];
  const container = byId(definition.options);
  const term = byId(definition.input).value.trim().toLocaleLowerCase('pt-BR');
  const values = [...new Set(allCatalogProducts.map((product) => product[definition.property]))]
    .filter((value) => !term || value.toLocaleLowerCase('pt-BR').includes(term))
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));
  container.replaceChildren();
  if (!values.length) {
    const empty = document.createElement('p');
    empty.className = 'filter-empty';
    empty.textContent = 'Nenhuma opção encontrada.';
    container.append(empty);
  }
  values.forEach((value) => {
    const label = document.createElement('label');
    label.className = 'check-row filter-option';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = definition.selected.has(value);
    checkbox.addEventListener('change', () => {
      checkbox.checked ? definition.selected.add(value) : definition.selected.delete(value);
      updateFilterPlaceholder(definition);
      loadPickerProducts();
    });
    const text = document.createElement('span');
    text.textContent = value;
    label.append(checkbox, text);
    container.append(label);
  });
  updateFilterPlaceholder(definition);
}

async function loadCatalogFilters() {
  const data = await request('/produtos');
  allCatalogProducts = data.products || [];
  Object.entries(filterDefinitions).forEach(([type, definition]) => {
    const available = new Set(allCatalogProducts.map((product) => product[definition.property]));
    [...definition.selected].forEach((value) => {
      if (!available.has(value)) definition.selected.delete(value);
    });
    renderFilterOptions(type);
  });
}

function updateSelectedCount() {
  byId('selected-count').textContent = `${selectedProductEans.size} selecionado(s)`;
  byId('select-all-products').checked = catalogProducts.length > 0
    && catalogProducts.every((product) => selectedProductEans.has(product.ean));
}

function hasActiveProductFilter() {
  return Boolean(byId('quick-product-search').value.trim())
    || selectedNames.size > 0
    || selectedCategories.size > 0
    || selectedFamilies.size > 0;
}

function renderProductPicker() {
  const list = byId('product-picker-list');
  list.replaceChildren();
  const hasFilter = hasActiveProductFilter();
  list.classList.toggle('awaiting-filter', !hasFilter);
  byId('filtered-select-all').hidden = !hasFilter || catalogProducts.length === 0;
  if (!catalogProducts.length) {
    const empty = document.createElement('p');
    empty.className = 'picker-product';
    empty.textContent = hasFilter
      ? 'Nenhum produto encontrado com estes filtros.'
      : 'Digite ou selecione um filtro para visualizar os produtos.';
    list.append(empty);
  }
  catalogProducts.forEach((product) => {
    const label = document.createElement('label');
    label.className = 'check-row picker-product';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selectedProductEans.has(product.ean);
    checkbox.addEventListener('change', () => {
      checkbox.checked ? selectedProductEans.add(product.ean) : selectedProductEans.delete(product.ean);
      updateSelectedCount();
    });
    const description = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = product.name;
    const details = document.createElement('small');
    details.textContent = `${product.ean} · ${product.category} · ${product.family}`;
    description.append(name, document.createElement('br'), details);
    label.append(checkbox, description);
    list.append(label);
  });
  updateSelectedCount();
}

async function loadPickerProducts() {
  const search = byId('quick-product-search').value.trim().toLocaleLowerCase('pt-BR');
  if (!hasActiveProductFilter()) {
    catalogProducts = [];
    renderProductPicker();
    return;
  }
  catalogProducts = allCatalogProducts.filter((product) => {
    const matchesSearch = !search || [product.ean, product.sku, product.name, product.category, product.family]
      .some((value) => String(value || '').toLocaleLowerCase('pt-BR').includes(search));
    return matchesSearch
      && (!selectedNames.size || selectedNames.has(product.name))
      && (!selectedCategories.size || selectedCategories.has(product.category))
      && (!selectedFamilies.size || selectedFamilies.has(product.family));
  });
  renderProductPicker();
}

function actionButton(label, className, handler) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `table-action ${className}`.trim();
  button.textContent = label;
  button.addEventListener('click', handler);
  return button;
}

function fillProductForm(product) {
  byId('product-id').value = product._id;
  byId('catalog-ean').value = product.ean;
  byId('catalog-sku').value = product.sku || '';
  byId('catalog-name').value = product.name;
  byId('catalog-category').value = product.category;
  byId('catalog-family').value = product.family;
  byId('product-form-title').textContent = 'Editar produto';
  byId('cancel-edit').hidden = false;
  byId('catalog-ean').focus();
}

function resetProductForm() {
  byId('product-form').reset();
  byId('product-id').value = '';
  byId('product-form-title').textContent = 'Cadastrar produto';
  byId('cancel-edit').hidden = true;
}

async function loadCatalogTable() {
  const data = await request('/produtos');
  const products = data.products || [];
  const body = byId('catalog-body');
  const viewBody = byId('catalog-view-body');
  body.replaceChildren();
  viewBody.replaceChildren();
  products.forEach((product) => {
    const viewRow = viewBody.insertRow();
    appendCell(viewRow, product.ean);
    appendCell(viewRow, product.sku || '—');
    appendCell(viewRow, product.name);
    appendCell(viewRow, product.category);
    appendCell(viewRow, product.family);

    const row = body.insertRow();
    appendCell(row, product.ean);
    appendCell(row, product.sku || '—');
    appendCell(row, product.name);
    appendCell(row, product.category);
    appendCell(row, product.family);
    const actions = row.insertCell();
    actions.append(
      actionButton('Editar', '', () => fillProductForm(product)),
      actionButton('Excluir', 'danger', async () => {
        if (!window.confirm(`Excluir ${product.name} do catálogo?`)) return;
        try {
          await request(`/produtos/${encodeURIComponent(product._id)}`, { method: 'DELETE' });
          selectedProductEans.delete(product.ean);
          await refreshCatalog();
          setMessage(byId('catalog-message'), 'Produto excluído.', 'success');
        } catch (error) { setMessage(byId('catalog-message'), error.message, 'error'); }
      })
    );
  });
  byId('catalog-count').textContent = `${products.length} produto(s)`;
  byId('catalog-view-count').textContent = `${products.length} produto(s)`;
}

async function refreshCatalog() {
  await loadCatalogFilters();
  await Promise.all([loadPickerProducts(), loadCatalogTable()]);
}

function cheapestListing(result) {
  return (result.listings || []).reduce(
    (cheapest, listing) => !cheapest || listing.price < cheapest.price ? listing : cheapest,
    null
  );
}

function appendCell(row, value) {
  const cell = row.insertCell();
  cell.textContent = value;
  return cell;
}

function marketplaceLinks(listings) {
  const links = new Map();
  (listings || []).forEach((listing) => {
    if (listing.marketplace && listing.link && !links.has(listing.marketplace)) {
      links.set(listing.marketplace, listing.link);
    }
  });
  return links;
}

function renderResults(results) {
  const body = byId('results-body');
  body.replaceChildren();

  results.forEach((result) => {
    const row = body.insertRow();
    appendCell(row, result.ean || '—');
    if (result.error && !result.listingsCount) {
      row.className = 'error-row';
      const cell = row.insertCell();
      cell.colSpan = 8;
      cell.textContent = result.error;
      return;
    }

    const cheapest = cheapestListing(result);
    appendCell(row, cheapest?.title || '—');
    appendCell(row, (result.marketplaces || []).join(', ') || cheapest?.marketplace || '—');
    appendCell(row, result.minPrice == null ? '—' : currency.format(result.minPrice));
    appendCell(row, result.maxPrice == null ? '—' : currency.format(result.maxPrice));
    appendCell(row, result.averagePrice == null ? '—' : currency.format(result.averagePrice));
    appendCell(row, String(result.listingsCount ?? 0));
    const sellerCell = row.insertCell();
    if (cheapest?.link) {
      const link = document.createElement('a');
      link.href = cheapest.link;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = cheapest.seller;
      sellerCell.append(link);
    } else {
      sellerCell.textContent = cheapest?.seller || '—';
    }
    const linksCell = row.insertCell();
    const links = marketplaceLinks(result.listings);
    if (!links.size) {
      linksCell.textContent = result.listings?.some((listing) => listing.demo)
        ? 'Disponível na busca real'
        : '—';
    } else {
      [...links].forEach(([marketplace, url], index) => {
        if (index) linksCell.append(document.createTextNode(' · '));
        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = marketplace;
        linksCell.append(link);
      });
    }
  });

  byId('results-count').textContent = `${results.length} produto(s) consultado(s)`;
  byId('results-card').hidden = false;
  byId('demo-notice').hidden = !results.some((result) =>
    (result.sources || []).some((source) => source.name?.includes('Demonstração'))
  );
  renderDetails(results);
}

function conditionLabel(condition) {
  const labels = { new: 'Novo', used: 'Usado', not_specified: 'Não informada' };
  return labels[condition] || condition || 'Não informada';
}

function renderDetails(results) {
  const body = byId('details-body');
  body.replaceChildren();
  const offers = results.flatMap((result) =>
    (result.listings || []).map((listing) => ({ ean: result.ean, ...listing }))
  ).sort((a, b) => a.ean.localeCompare(b.ean) || a.price - b.price);

  offers.forEach((offer) => {
    const row = body.insertRow();
    appendCell(row, offer.ean);
    appendCell(row, offer.marketplace || '—');
    appendCell(row, offer.title || '—');
    appendCell(row, Number.isFinite(offer.price) ? currency.format(offer.price) : '—');
    appendCell(row, offer.seller || '—');
    appendCell(row, offer.soldQuantity == null ? 'Não informado' : String(offer.soldQuantity));
    appendCell(row, conditionLabel(offer.condition));
    appendCell(row, offer.freeShipping ? 'Sim' : 'Não');
    const linkCell = row.insertCell();
    if (offer.link) {
      const link = document.createElement('a');
      link.href = offer.link;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Ver produto';
      linkCell.append(link);
    } else {
      linkCell.textContent = offer.demo ? 'Disponível na busca real' : '—';
    }
  });

  byId('details-count').textContent = `${offers.length} oferta(s), ordenadas pelo menor preço de cada EAN`;
  byId('details-card').hidden = offers.length === 0;
}

byId('search-button').addEventListener('click', async () => {
  const typedValue = byId('quick-product-search').value.trim();
  const typedEans = /^\d{8,14}$/.test(typedValue) ? [typedValue] : [];
  const eans = [...new Set([...typedEans, ...selectedProductEans])];
  if (!eans.length) {
    setMessage(byId('search-message'), 'Selecione pelo menos um produto ou digite um EAN válido.', 'error');
    return;
  }

  const button = byId('search-button');
  setLoading(button, true);
  setMessage(byId('search-message'), 'Consultando os marketplaces…');
  try {
    const data = await request('/buscar/lote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(eans)
    });
    currentResults = data.results || [];
    renderResults(currentResults);
    byId('export-button').disabled = currentResults.length === 0;
    const errors = currentResults.filter((item) => item.error).length;
    setMessage(
      byId('search-message'),
      errors ? `Busca concluída com ${errors} item(ns) sem resultado.` : 'Busca concluída com sucesso.',
      errors ? 'error' : 'success'
    );
  } catch (error) {
    setMessage(byId('search-message'), error.message, 'error');
  } finally {
    setLoading(button, false);
  }
});

function csvCell(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

byId('export-button').addEventListener('click', () => {
  const header = ['EAN', 'Marketplace', 'Produto', 'Preço', 'Vendedor', 'Quantidade vendida', 'Condição', 'Frete grátis', 'Link', 'Preço mínimo do EAN', 'Preço máximo do EAN', 'Preço médio do EAN'];
  const rows = currentResults.flatMap((result) => (result.listings || []).map((listing) => [
    result.ean, listing.marketplace, listing.title, listing.price, listing.seller,
    listing.soldQuantity ?? 'Não informado', conditionLabel(listing.condition),
    listing.freeShipping ? 'Sim' : 'Não', listing.link,
    result.minPrice, result.maxPrice, result.averagePrice
  ].map(csvCell).join(';')));
  const blob = new Blob([`\ufeff${header.map(csvCell).join(';')}\r\n${rows.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `price-monitor-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
});

let catalogSearchTimer;
byId('quick-product-search').addEventListener('input', () => {
  clearTimeout(catalogSearchTimer);
  catalogSearchTimer = setTimeout(() => loadPickerProducts().catch((error) => {
    byId('product-picker-list').textContent = error.message;
  }), 250);
});
Object.entries(filterDefinitions).forEach(([type, definition]) => {
  const input = byId(definition.input);
  input.addEventListener('focus', () => {
    closeFilterMenus(type);
    input.closest('.filter-field').classList.add('open');
  });
  input.addEventListener('click', () => {
    closeFilterMenus(type);
    input.closest('.filter-field').classList.add('open');
  });
  input.addEventListener('input', () => renderFilterOptions(type));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      input.blur();
      closeFilterMenus();
    }
  });
});
document.addEventListener('click', (event) => {
  if (!event.target.closest('.filter-field')) closeFilterMenus();
});
byId('select-all-products').addEventListener('change', (event) => {
  catalogProducts.forEach((product) => {
    event.target.checked ? selectedProductEans.add(product.ean) : selectedProductEans.delete(product.ean);
  });
  renderProductPicker();
});

byId('cancel-edit').addEventListener('click', resetProductForm);
byId('product-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = byId('product-id').value;
  const product = {
    ean: byId('catalog-ean').value.trim(),
    sku: byId('catalog-sku').value.trim(),
    name: byId('catalog-name').value.trim(),
    category: byId('catalog-category').value.trim(),
    family: byId('catalog-family').value.trim()
  };
  try {
    await request(id ? `/produtos/${encodeURIComponent(id)}` : '/produtos', {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(product)
    });
    resetProductForm();
    await refreshCatalog();
    setMessage(byId('catalog-message'), id ? 'Produto atualizado.' : 'Produto cadastrado.', 'success');
  } catch (error) {
    setMessage(byId('catalog-message'), error.message, 'error');
  }
});

byId('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  setLoading(button, true);
  setMessage(byId('login-message'), 'Validando acesso…');
  try {
    const data = await request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: byId('login-username').value.trim(),
        password: byId('login-password').value
      })
    });
    adminToken = data.token;
    sessionStorage.setItem('priceMonitorAdminToken', adminToken);
    byId('login-form').reset();
    setMessage(byId('login-message'));
    setAdminAccess(true);
    await loadCatalogTable();
  } catch (error) {
    setMessage(byId('login-message'), error.message, 'error');
  } finally {
    setLoading(button, false);
  }
});

byId('logout-button').addEventListener('click', () => {
  setAdminAccess(false);
  setMessage(byId('login-message'), 'Sessão encerrada.', 'success');
});

loadApiMode();
restoreAdminSession();
refreshCatalog().catch((error) => {
  byId('product-picker-list').textContent = error.message;
  setMessage(byId('catalog-message'), error.message, 'error');
});
