// Vercel Serverless Function: GET /api/config
// Returns public deployment configuration and target backend URL

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const backendUrl = process.env.SETU_BACKEND_URL || process.env.NEXT_PUBLIC_SETU_BACKEND_URL || '';

  res.status(200).json({
    backendUrl: backendUrl ? backendUrl.replace(/\/+$/, '') : null,
    environment: process.env.VERCEL_ENV || 'production',
    service: 'setu-vercel-frontend',
    message: backendUrl
      ? 'Configured persistent simulation backend URL active.'
      : 'No SETU_BACKEND_URL set in environment variables. Set in Vercel project settings or enter via the dashboard ⚡ Backend button.'
  });
}
