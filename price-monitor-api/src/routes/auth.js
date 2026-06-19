const express = require('express');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { requireAdmin, jwtSecret } = require('../middleware/auth');

const router = express.Router();

function safeEqual(received, expected) {
  const receivedBuffer = Buffer.from(String(received));
  const expectedBuffer = Buffer.from(String(expected));
  return receivedBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
}

router.post('/login', (req, res) => {
  const demo = process.env.DEMO_MODE === 'true';
  const expectedUser = process.env.ADMIN_USERNAME || (demo ? 'admin' : '');
  const expectedPassword = process.env.ADMIN_PASSWORD || (demo ? 'admin123' : '');
  const valid = expectedUser && expectedPassword
    && safeEqual(req.body?.username, expectedUser)
    && safeEqual(req.body?.password, expectedPassword);

  if (!valid) return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
  const token = jwt.sign({ sub: expectedUser, role: 'admin' }, jwtSecret(), { expiresIn: '8h' });
  return res.json({ token, user: expectedUser, expiresIn: 28800 });
});

router.get('/me', requireAdmin, (req, res) => res.json({ user: req.admin.sub, role: req.admin.role }));

module.exports = router;
