// Vercel Serverless Function: GET /api/version
// Returns frontend deployment build metadata and commit information

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const gitCommit = (process.env.VERCEL_GIT_COMMIT_SHA || process.env.GIT_COMMIT || '').trim() || null;
  const buildTime = (process.env.BUILD_TIME || '').trim() || null;
  const environment = process.env.VERCEL_ENV || process.env.NODE_ENV || 'unknown';

  res.status(200).json({
    service: 'project-setu-frontend',
    gitCommit,
    buildTime,
    environment
  });
}

