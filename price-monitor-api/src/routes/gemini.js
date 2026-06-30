const express = require('express');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Entrega a chave apenas para admins autenticados
router.get('/key', requireAdmin, (_req, res) => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(503).json({ error: 'GEMINI_API_KEY não configurada no servidor.' });
  return res.json({ key });
});

module.exports = router;
