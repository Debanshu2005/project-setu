// Vercel Serverless Function: GET /api/status
// Note: This endpoint runs on Vercel Serverless (Frontend Host).
// The authoritative native C++ simulation engine runs on the persistent Render backend.

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const backendUrl = process.env.SETU_BACKEND_URL || process.env.NEXT_PUBLIC_SETU_BACKEND_URL || '';

  res.status(200).json({
    status: 'online',
    host: 'Vercel Frontend Host',
    executionModel: 'Separated Architecture: Vercel Dashboard Client + Render Native C++ Backend',
    backendUrlConfigured: Boolean(backendUrl),
    backendUrl: backendUrl ? backendUrl.replace(/\/+$/, '') : null,
    simulatorFound: false, // Native C++ binary is hosted on Render, not inside Vercel serverless
    note: backendUrl
      ? 'Target backend configured. Connect to backend URL for authoritative native C++ simulation.'
      : 'Backend URL not configured in Vercel environment variables. Please set SETU_BACKEND_URL or use the ⚡ Backend button in the dashboard.'
  });
}
