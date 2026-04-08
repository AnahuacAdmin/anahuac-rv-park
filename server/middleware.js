const jwt = require('jsonwebtoken');
const crypto = require('crypto');

let SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET environment variable must be set in production');
  }
  SECRET = crypto.randomBytes(64).toString('hex');
  console.warn('JWT_SECRET not set — generated an ephemeral dev secret. Tokens will not survive a restart.');
}

const TOKEN_TTL = '30m';

function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { authenticate, SECRET, TOKEN_TTL };
