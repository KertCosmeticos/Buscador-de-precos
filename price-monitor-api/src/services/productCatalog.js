const Product = require('../models/Product');

const demoProducts = [
  { _id: 'demo-1', ean: '7896380606429', sku: 'CAB-001', name: 'Shampoo Love My Hair Curly 300ml', category: 'Cabelos', family: 'Love My Hair', active: true },
  { _id: 'demo-2', ean: '7896380606436', sku: 'CAB-002', name: 'Condicionador Love My Hair Curly 300ml', category: 'Cabelos', family: 'Love My Hair', active: true },
  { _id: 'demo-3', ean: '7896380606504', sku: 'FIN-001', name: 'Óleo Finalizador 60ml', category: 'Finalizadores', family: 'Phyto Gen', active: true },
  { _id: 'demo-4', ean: '7896380606511', sku: 'TRA-001', name: 'Máscara de Tratamento 250g', category: 'Tratamentos', family: 'Phyto Gen', active: true }
];

function isDemo() {
  return process.env.DEMO_MODE === 'true';
}

function matches(product, filters) {
  const search = String(filters.search || '').toLocaleLowerCase('pt-BR');
  return product.active !== false
    && (!search || [product.name, product.ean, product.sku, product.category, product.family].some((value) => String(value).toLocaleLowerCase('pt-BR').includes(search)))
    && (!filters.category || product.category === filters.category)
    && (!filters.family || product.family === filters.family);
}

async function listProducts(filters = {}) {
  if (isDemo()) return demoProducts.filter((product) => matches(product, filters));
  const query = { active: true };
  if (filters.category) query.category = filters.category;
  if (filters.family) query.family = filters.family;
  if (filters.search) {
    const escaped = String(filters.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query.$or = [
      { name: new RegExp(escaped, 'i') },
      { ean: new RegExp(escaped, 'i') },
      { sku: new RegExp(escaped, 'i') },
      { category: new RegExp(escaped, 'i') },
      { family: new RegExp(escaped, 'i') }
    ];
  }
  return Product.find(query).sort({ name: 1 }).lean();
}

async function getFilters() {
  const products = isDemo() ? demoProducts : await Product.find({ active: true }).select('category family').lean();
  return {
    categories: [...new Set(products.map((item) => item.category))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    families: [...new Set(products.map((item) => item.family))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  };
}

async function getProductByEan(ean) {
  if (isDemo()) return demoProducts.find((product) => product.ean === ean && product.active !== false) || null;
  return Product.findOne({ ean, active: true }).lean();
}

function cleanProduct(input) {
  return {
    ean: String(input.ean || '').trim(),
    sku: String(input.sku || '').trim(),
    name: String(input.name || '').trim(),
    category: String(input.category || '').trim(),
    family: String(input.family || '').trim(),
    volume: String(input.volume || '').trim(),
    ncm: String(input.ncm || '').trim(),
    netPrice: input.netPrice == null ? null : Number(input.netPrice),
    searchTerm: String(input.searchTerm || '').trim(),
    tokens: input.tokens || [],
    aliases: input.aliases || [],
    requiredWords: input.requiredWords || [],
    forbiddenWords: input.forbiddenWords || [],
    nuance: String(input.nuance || '').trim(),
    color: String(input.color || '').trim(),
    variant: String(input.variant || '').trim(),
    active: input.active !== false
  };
}

function sameProduct(left, right) {
  const fields = ['ean', 'sku', 'name', 'category', 'family', 'volume', 'ncm', 'netPrice', 'searchTerm', 'active'];
  return fields.every((field) => left[field] === right[field])
    && ['tokens', 'aliases', 'requiredWords', 'forbiddenWords'].every((field) => JSON.stringify(left[field]) === JSON.stringify(right[field]));
}

async function createProduct(input) {
  const product = cleanProduct(input);
  if (isDemo()) {
    if (demoProducts.some((item) => item.ean === product.ean)) throw Object.assign(new Error('Este EAN já está cadastrado.'), { status: 409 });
    const created = { _id: `demo-${Date.now()}`, ...product };
    demoProducts.push(created);
    return created;
  }
  return Product.create(product);
}

async function updateProduct(id, input) {
  const product = cleanProduct(input);
  if (isDemo()) {
    const index = demoProducts.findIndex((item) => item._id === id);
    if (index < 0) return null;
    if (demoProducts.some((item, itemIndex) => itemIndex !== index && item.ean === product.ean)) throw Object.assign(new Error('Este EAN já está cadastrado.'), { status: 409 });
    demoProducts[index] = { _id: id, ...product };
    return demoProducts[index];
  }
  return Product.findByIdAndUpdate(id, product, { new: true, runValidators: true }).lean();
}

async function deleteProduct(id) {
  if (isDemo()) {
    const index = demoProducts.findIndex((item) => item._id === id);
    if (index < 0) return false;
    demoProducts.splice(index, 1);
    return true;
  }
  return Boolean(await Product.findByIdAndDelete(id));
}

async function importProducts(inputs) {
  const products = inputs.map(cleanProduct);
  if (isDemo()) {
    let created = 0;
    let updated = 0;
    let unchanged = 0;
    products.forEach((product) => {
      const index = demoProducts.findIndex((item) => item.ean === product.ean);
      if (index < 0) {
        demoProducts.push({ _id: `demo-${Date.now()}-${created}`, ...product });
        created += 1;
      } else if (sameProduct(cleanProduct(demoProducts[index]), product)) {
        unchanged += 1;
      } else {
        demoProducts[index] = { ...demoProducts[index], ...product };
        updated += 1;
      }
    });
    return { total: products.length, created, updated, unchanged };
  }

  const eans = products.map((product) => product.ean);
  const existing = await Product.find({ ean: { $in: eans } }).lean();
  const existingByEan = new Map(existing.map((product) => [product.ean, cleanProduct(product)]));
  const operations = [];
  let created = 0;
  let updated = 0;
  let unchanged = 0;

  products.forEach((product) => {
    const current = existingByEan.get(product.ean);
    if (!current) {
      created += 1;
    } else if (sameProduct(current, product)) {
      unchanged += 1;
      return;
    } else {
      updated += 1;
    }
    operations.push({
      updateOne: {
        filter: { ean: product.ean },
        update: { $set: product },
        upsert: true
      }
    });
  });

  if (operations.length) await Product.bulkWrite(operations, { ordered: false });
  return { total: products.length, created, updated, unchanged };
}

module.exports = { listProducts, getFilters, getProductByEan, createProduct, updateProduct, deleteProduct, importProducts };
