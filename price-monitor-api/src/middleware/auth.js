const jwt = require('jsonwebtoken');

function jwtSecret() {
  return process.env.JWT_SECRET || (process.env.DEMO_MODE === 'true' ? 'demo-secret-not-for-production' : '');
}

function requireAdmin(req, res, next) {
  const authorization = req.headers.authorization || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Faça login para acessar esta operação.' });
  try {
    req.admin = jwt.verify(token, jwtSecret());
    return next();
  } catch {
    return res.status(401).json({ error: 'Sua sessão expirou. Faça login novamente.' });
  }
}

module.exports = { requireAdmin, jwtSecret };
