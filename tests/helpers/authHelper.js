const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'discord_clone_super_secret_jwt_key_2026';

/**
 * Generate a JWT token for testing.
 * @param {Object} payload
 * @param {string} [secret]
 * @param {Object} [options]
 * @returns {string}
 */
function generateToken(payload = {}, secret = JWT_SECRET, options = {}) {
  const defaultPayload = {
    userId: 'user_default_test_id',
    username: 'TestUser',
    email: 'test@example.com',
    role: 'USER',
    ...payload,
  };

  return jwt.sign(defaultPayload, secret, {
    algorithm: 'HS256',
    expiresIn: '2h',
    ...options,
  });
}

function getApprovedUserToken(userId = 'user_alice', username = 'Alice', role = 'USER') {
  return generateToken({
    userId,
    username,
    email: `${username.toLowerCase()}@example.com`,
    role,
  });
}

function getUnapprovedUserToken(userId = 'user_pending', username = 'PendingUser') {
  return generateToken({
    userId,
    username,
    email: 'pending@example.com',
    role: 'USER',
  });
}

function getAdminToken(userId = 'user_admin', username = 'AdminUser') {
  return generateToken({
    userId,
    username,
    email: 'admin@example.com',
    role: 'ADMIN',
  });
}

function getInvalidToken() {
  return 'invalid.token.structure';
}

function getWrongSecretToken(userId = 'user_hacker') {
  return jwt.sign(
    { userId, username: 'Hacker', email: 'hacker@example.com' },
    'wrong_secret_key_12345',
    { algorithm: 'HS256' }
  );
}

module.exports = {
  JWT_SECRET,
  generateToken,
  getApprovedUserToken,
  getUnapprovedUserToken,
  getAdminToken,
  getInvalidToken,
  getWrongSecretToken,
};
