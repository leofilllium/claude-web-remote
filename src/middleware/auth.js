/**
 * Optional basic auth middleware.
 * Activated when TUNNEL_AUTH_USER and TUNNEL_AUTH_PASS are set in .env.
 * Protects the app when exposed via a public tunnel.
 */
export function basicAuth(req, res, next) {
  const user = process.env.TUNNEL_AUTH_USER;
  const pass = process.env.TUNNEL_AUTH_PASS;

  // If credentials aren't configured, skip auth
  if (!user || !pass) return next();

  // Health check always open (for uptime monitors)
  if (req.path === '/api/health') return next();

  const header = req.headers.authorization;

  if (!header || !header.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="Claude Web Remote"');
    return res.status(401).send('Authentication required');
  }

  const encoded = header.slice(6);
  const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
  const [u, p] = decoded.split(':');

  if (u === user && p === pass) {
    return next();
  }

  res.set('WWW-Authenticate', 'Basic realm="Claude Web Remote"');
  return res.status(401).send('Invalid credentials');
}
