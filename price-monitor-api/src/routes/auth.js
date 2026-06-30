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
    const token = jwt.sign({ sub: user.username, role: 'admin', uid: String(user._id), isRoot: !!user.isRoot }, jwtSecret(), { expiresIn: '8h' });
    return res.json({ token, user: user.username, isRoot: !!user.isRoot, expiresIn: 28800 });
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

router.get('/me', requireAdmin, async (req, res) => {
  try {
    const user = await AdminUser.findOne({ username: req.admin.sub }, { isRoot: 1 }).lean();
    return res.json({ user: req.admin.sub, role: req.admin.role, isRoot: !!(user?.isRoot) });
  } catch {
    return res.json({ user: req.admin.sub, role: req.admin.role, isRoot: !!(req.admin.isRoot) });
  }
});

// ── Gestão de usuários administradores ────────────────────────────────────

router.get('/usuarios', requireAdmin, async (req, res) => {
  try {
    const users = await AdminUser.find({}, { passwordHash: 0, resetToken: 0, resetTokenExp: 0 }).sort({ createdAt: 1 }).lean();
    const me = req.admin.sub;
    return res.json(users.map(u => ({ ...u, isCurrentUser: u.username === me })));
  } catch { return res.status(500).json({ error: 'Erro ao listar usuários.' }); }
});

router.post('/usuarios', requireAdmin, async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!username || !password) return res.status(400).json({ error: 'Usuário e senha são obrigatórios.' });
  if (!email) return res.status(400).json({ error: 'E-mail é obrigatório.' });
  if (password.length < 6) return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });
  try {
    await AdminUser.create({ username, email, passwordHash: hashPassword(password) });
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

router.put('/usuarios/:id/nome', requireAdmin, async (req, res) => {
  const username = String(req.body?.username || '').trim();
  if (!username) return res.status(400).json({ error: 'Nome é obrigatório.' });
  try {
    const result = await AdminUser.updateOne({ _id: req.params.id }, { $set: { username } });
    if (!result.matchedCount) return res.status(404).json({ error: 'Usuário não encontrado.' });
    return res.json({ ok: true });
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ error: 'Este nome já está em uso.' });
    return res.status(500).json({ error: 'Erro ao atualizar nome.' });
  }
});

router.put('/usuarios/:id/email', requireAdmin, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  try {
    const result = await AdminUser.updateOne({ _id: req.params.id }, { $set: { email } });
    if (!result.matchedCount) return res.status(404).json({ error: 'Usuário não encontrado.' });
    return res.json({ ok: true });
  } catch { return res.status(500).json({ error: 'Erro ao atualizar e-mail.' }); }
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

// ── Redefinição de senha por e-mail ──────────────────────────────────────

async function sendResetEmail(toEmail, username, resetUrl) {
  if (!process.env.SMTP_HOST) throw new Error('SMTP não configurado (variável SMTP_HOST ausente).');
  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: toEmail,
    subject: 'Price Monitor — Redefinição de Senha',
    html: `<p>Olá, <strong>${username}</strong>!</p>
           <p>Clique no link abaixo para redefinir sua senha. O link expira em 1 hora.</p>
           <p><a href="${resetUrl}">${resetUrl}</a></p>
           <p>Se você não solicitou a redefinição, ignore este e-mail.</p>`
  });
}

router.post('/usuarios/:id/resetar-senha', requireAdmin, async (req, res) => {
  try {
    const user = await AdminUser.findById(req.params.id).lean();
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
    const token = crypto.randomBytes(32).toString('hex');
    const exp = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await AdminUser.updateOne({ _id: user._id }, { $set: { resetToken: token, resetTokenExp: exp } });
    const baseUrl = (process.env.PANEL_URL || req.headers.referer || req.headers.origin || '').replace(/[?#].*$/, '').replace(/\/$/, '');
    const resetUrl = `${baseUrl}?reset_token=${token}`;
    let emailSent = false;
    let emailError = null;
    if (user.email) {
      try { await sendResetEmail(user.email, user.username, resetUrl); emailSent = true; }
      catch (e) { emailError = e.message; }
    }
    return res.json({ ok: true, resetUrl, emailSent, hasEmail: !!user.email, emailError });
  } catch { return res.status(500).json({ error: 'Erro ao gerar link de redefinição.' }); }
});

router.post('/redefinir-senha', async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ error: 'Token e senha são obrigatórios.' });
  if (String(password).length < 6) return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });
  try {
    const user = await AdminUser.findOne({ resetToken: token }).lean();
    if (!user) return res.status(400).json({ error: 'Link inválido. Gere um novo link de redefinição.' });
    if (!user.resetTokenExp || new Date(user.resetTokenExp) < new Date()) {
      return res.status(400).json({ error: 'Link expirado. Gere um novo link de redefinição.' });
    }
    await AdminUser.updateOne({ _id: user._id }, { $set: { passwordHash: hashPassword(String(password)), resetToken: null, resetTokenExp: null } });
    return res.json({ ok: true });
  } catch { return res.status(500).json({ error: 'Erro ao redefinir senha.' }); }
});

router.post('/esqueci-senha', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'E-mail é obrigatório.' });
  try {
    const user = await AdminUser.findOne({ email }).lean();
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      const exp = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await AdminUser.updateOne({ _id: user._id }, { $set: { resetToken: token, resetTokenExp: exp } });
      const baseUrl = (process.env.PANEL_URL || req.headers.referer || req.headers.origin || '').replace(/[?#].*$/, '').replace(/\/$/, '');
      const resetUrl = `${baseUrl}?reset_token=${token}`;
      try { await sendResetEmail(email, user.username, resetUrl); } catch {}
    }
    return res.json({ ok: true });
  } catch { return res.status(500).json({ error: 'Erro ao processar solicitação.' }); }
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
