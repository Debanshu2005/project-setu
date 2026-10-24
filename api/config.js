// Vercel Serverless Function: GET /api/config
// Returns public deployment configuration and validated target Render backend URL

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const DEFAULT_BACKEND = 'https://project-setu-backend.onrender.com';
  const envUrl = (process.env.SETU_BACKEND_URL || process.env.NEXT_PUBLIC_SETU_BACKEND_URL || '').trim();
  const rawUrl = envUrl || DEFAULT_BACKEND;
  const vercelEnv = process.env.VERCEL_ENV || '';
  const nodeEnv = process.env.NODE_ENV || '';
  const isProduction = vercelEnv === 'production' || (nodeEnv === 'production' && !vercelEnv);

  let backendUrl = null;
  let validationError = null;

  if (rawUrl) {
    const normalized = rawUrl.replace(/\/+$/, '');
    try {
      const parsed = new URL(normalized);
      if (isProduction && parsed.protocol !== 'https:') {
        validationError = `Invalid protocol: Production SETU_BACKEND_URL must use https:// (got ${parsed.protocol}//)`;
      } else if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        validationError = `Invalid protocol: SETU_BACKEND_URL must use https:// or http:// (got ${parsed.protocol}//)`;
      } else if (isProduction && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')) {
        validationError = 'Invalid host: Production SETU_BACKEND_URL cannot point to localhost.';
      } else {
        backendUrl = normalized;
      }
    } catch {
      validationError = `Malformed URL: SETU_BACKEND_URL value "${rawUrl}" is not a valid URL.`;
    }
  } else {
    validationError = 'SETU_BACKEND_URL environment variable is missing. Configure your Render backend URL in Vercel Project Settings > Environment Variables.';
  }

  res.status(200).json({
    configured: Boolean(backendUrl),
    backendUrl,
    isDefaultFallback: !envUrl,
    error: validationError,
    environment: vercelEnv || nodeEnv || 'development',
    service: 'setu-vercel-frontend',
    timestamp: Date.now(),
    message: backendUrl
      ? (envUrl ? 'Authoritative Render backend URL configured.' : 'Verified production Render backend URL active (default fallback).')
      : validationError
  });
}
