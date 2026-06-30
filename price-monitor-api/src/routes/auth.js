const express = require('express');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { requireAdmin, jwtSecret } = require('../middleware/auth');
const AdminUser = require('../models/AdminUser');
const ImportLog = require('../models/ImportLog');
const Product = require('../models/Product');
const Site = require('../models/Site');

const router = express.Router();

const demoMode = () => process.env.DEMO_MODE === 'true';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  try {
    const derived = crypto.scryptSync(String(password), salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(derived, 'hex'), Buffer.from(hash, 'hex'));
  } catch { return false; }
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

async function ensureRootAdmin() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) return;
  const exists = await AdminUser.exists({ isRoot: true });
  if (!exists) {
    await AdminUser.create({ username, passwordHash: hashPassword(password), isRoot: true });
  }
}

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(401).json({ error: 'Usuário ou senha incorretos.' });

  if (demoMode()) {
    if (username !== 'admin' || password !== 'admin123') return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
    const token = jwt.sign({ sub: username, role: 'admin' }, jwtSecret(), { expiresIn: '8h' });
    return res.json({ token, user: username, expiresIn: 28800 });
  }

  try {
    await ensureRootAdmin();
    const user = await AdminUser.findOne({ username }).lean();
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
    }
    const token = jwt.sign({ sub: user.username, role: 'admin', uid: String(user._id) }, jwtSecret(), { expiresIn: '8h' });
    return res.json({ token, user: user.username, expiresIn: 28800 });
  } catch {
    // fallback para credenciais do .env se MongoDB indisponível
    const envUser = process.env.ADMIN_USERNAME;
    const envPwd = process.env.ADMIN_PASSWORD;
    if (envUser && envPwd && safeEqual(username, envUser) && safeEqual(password, envPwd)) {
      const token = jwt.sign({ sub: envUser, role: 'admin' }, jwtSecret(), { expiresIn: '8h' });
      return res.json({ token, user: envUser, expiresIn: 28800 });
    }
    return res.status(500).json({ error: 'Erro ao processar login. Tente novamente.' });
  }
});

router.get('/me', requireAdmin, (req, res) => res.json({ user: req.admin.sub, role: req.admin.role }));

// ── Gestão de usuários administradores ────────────────────────────────────

router.get('/usuarios', requireAdmin, async (req, res) => {
  try {
    const users = await AdminUser.find({}, { passwordHash: 0 }).sort({ createdAt: 1 }).lean();
    return res.json(users);
  } catch { return res.status(500).json({ error: 'Erro ao listar usuários.' }); }
});

router.post('/usuarios', requireAdmin, async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (!username || !password) return res.status(400).json({ error: 'Usuário e senha são obrigatórios.' });
  if (password.length < 6) return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });
  try {
    await AdminUser.create({ username, passwordHash: hashPassword(password) });
    return res.status(201).json({ ok: true });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: 'Este usuário já existe.' });
    return res.status(500).json({ error: 'Erro ao criar usuário.' });
  }
});

router.put('/usuarios/:id/senha', requireAdmin, async (req, res) => {
  const password = String(req.body?.password || '');
  if (!password) return res.status(400).json({ error: 'Senha é obrigatória.' });
  if (password.length < 6) return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });
  try {
    const result = await AdminUser.updateOne({ _id: req.params.id }, { $set: { passwordHash: hashPassword(password) } });
    if (!result.matchedCount) return res.status(404).json({ error: 'Usuário não encontrado.' });
    return res.json({ ok: true });
  } catch { return res.status(500).json({ error: 'Erro ao alterar senha.' }); }
});

router.delete('/usuarios/:id', requireAdmin, async (req, res) => {
  try {
    const user = await AdminUser.findById(req.params.id).lean();
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
    if (user.isRoot) return res.status(400).json({ error: 'O administrador principal não pode ser excluído.' });
    const total = await AdminUser.countDocuments();
    if (total <= 1) return res.status(400).json({ error: 'Não é possível excluir o único administrador.' });
    await AdminUser.deleteOne({ _id: req.params.id });
    return res.json({ ok: true });
  } catch { return res.status(500).json({ error: 'Erro ao excluir usuário.' }); }
});

// ── Registro de importações ───────────────────────────────────────────────

router.post('/importacoes', requireAdmin, async (req, res) => {
  const { importId, tipo, arquivo, total, criados, atualizados, refs } = req.body || {};
  if (!importId || !tipo) return res.status(400).json({ error: 'importId e tipo são obrigatórios.' });
  try {
    await ImportLog.create({
      importId, tipo,
      arquivo: arquivo || '',
      usuario: req.admin?.sub || '',
      total: total || 0,
      criados: criados || 0,
      atualizados: atualizados || 0,
      refs: refs || []
    });
    return res.json({ ok: true });
  } catch (e) {
    if (e.code === 11000) return res.json({ ok: true });
    return res.status(500).json({ error: 'Erro ao salvar log.' });
  }
});

router.get('/importacoes', requireAdmin, async (req, res) => {
  try {
    const logs = await ImportLog.find({}, { refs: 0 }).sort({ data: -1 }).limit(200).lean();
    return res.json(logs);
  } catch { return res.status(500).json({ error: 'Erro ao listar importações.' }); }
});

router.delete('/importacoes/:id', requireAdmin, async (req, res) => {
  try {
    const log = await ImportLog.findById(req.params.id).lean();
    if (!log) return res.status(404).json({ error: 'Log não encontrado.' });
    let removidos = 0;
    if (log.tipo === 'produtos' && log.refs?.length) {
      const result = await Product.deleteMany({ ean: { $in: log.refs } });
      removidos = result.deletedCount;
    } else if (log.tipo === 'sites' && log.refs?.length) {
      const result = await Site.deleteMany({ name: { $in: log.refs } });
      removidos = result.deletedCount;
    }
    await ImportLog.deleteOne({ _id: req.params.id });
    return res.json({ ok: true, removidos });
  } catch { return res.status(500).json({ error: 'Erro ao desfazer importação.' }); }
});

module.exports = router;
