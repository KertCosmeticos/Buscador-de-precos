const express = require('express');
const axios = require('axios');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.post('/search', requireAdmin, async (req, res, next) => {
  try {
    const key = process.env.SERPER_API_KEY;
    if (!key) return res.status(503).json({ error: 'SERPER_API_KEY não configurada no servidor.' });

    const { nome, ean } = req.body;
    if (!nome && !ean) return res.status(400).json({ error: 'Informe nome ou EAN.' });

    const q = nome ? `${nome} preço` : `${ean} preço`;

    const { data } = await axios.post(
      'https://google.serper.dev/shopping',
      { q, gl: 'br', hl: 'pt', num: 10 },
      { headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' } }
    );

    const resultados = (data.shopping || []).map((item) => ({
      produto: item.title,
      preco: parsePrice(item.price),
      loja: item.source,
      url: item.link
    }));

    return res.json({ resultados });
  } catch (err) { return next(err); }
});

function parsePrice(str) {
  if (!str) return null;
  const clean = String(str).replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.');
  const n = parseFloat(clean);
  return isNaN(n) ? null : n;
}

module.exports = router;
