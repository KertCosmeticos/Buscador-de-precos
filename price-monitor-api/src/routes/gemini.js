const express = require('express');

const router = express.Router();

const GEMINI_MODEL = 'gemini-2.0-flash';

router.post('/buscar', async (req, res) => {
  const { ean, nome } = req.body || {};
  if (!ean && !nome) return res.status(400).json({ error: 'EAN ou nome é obrigatório.' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'GEMINI_API_KEY não configurada no servidor.' });

  const termo = nome ? `"${nome}"` : `EAN ${ean}`;
  const prompt =
    `Pesquise o preço atual do produto ${termo} vendido no Brasil em lojas online e marketplaces. ` +
    `Liste todas as ofertas encontradas. ` +
    `Responda SOMENTE com JSON válido, sem texto adicional, neste formato exato:\n` +
    `{"resultados":[{"produto":"nome completo do produto","preco":0.00,"loja":"nome da loja","url":"https://..."}]}\n` +
    `Se não encontrar nenhuma oferta, retorne: {"resultados":[]}`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: { temperature: 0, maxOutputTokens: 2048 }
        })
      }
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const msg = err?.error?.message || response.statusText || `HTTP ${response.status}`;
      return res.status(502).json({ error: `Gemini: ${msg}` });
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Extrai JSON da resposta (o modelo pode adicionar markdown)
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return res.json({ resultados: [] });

    try {
      const parsed = JSON.parse(match[0]);
      return res.json({ resultados: Array.isArray(parsed.resultados) ? parsed.resultados : [] });
    } catch {
      return res.json({ resultados: [] });
    }
  } catch (error) {
    return res.status(500).json({ error: `Erro ao consultar Gemini: ${error.message}` });
  }
});

module.exports = router;
