const basicAuth = require('basic-auth');

/**
 * Simple HTTP Basic Auth gate for the admin/upload routes.
 * Username/password come from environment variables so nothing is hardcoded.
 */
function requireAdmin(req, res, next) {
  const expectedUser = process.env.ADMIN_USER;
  const expectedPass = process.env.ADMIN_PASSWORD;

  if (!expectedUser || !expectedPass) {
    console.error('ADMIN_USER / ADMIN_PASSWORD are not set — refusing all admin access until configured.');
    res.status(500).send('Admin access is not configured on this server yet.');
    return;
  }

  const credentials = basicAuth(req);
  if (!credentials || credentials.name !== expectedUser || credentials.pass !== expectedPass) {
    res.set('WWW-Authenticate', 'Basic realm="Admin"');
    res.status(401).send('Authentication required.');
    return;
  }
  next();
}

module.exports = { requireAdmin };
