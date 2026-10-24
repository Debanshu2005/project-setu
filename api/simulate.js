// Vercel Serverless Function: POST /api/simulate
// NOTICE: This serverless endpoint runs an ephemeral JavaScript demonstration fallback.
// For authoritative C++ simulation using the real setu::Node protocol core,
// target the persistent Render backend.

import { SetuSimulator } from '../simulation/js/simulator.js';

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const params = body.params || body;

    const sim = new SetuSimulator(params);

    // Apply triggers if provided
    if (Array.isArray(body.triggers)) {
      for (const tr of body.triggers) {
        sim.addTrigger(tr.node || tr.id || 1, tr.kind || 'short', tr.t || 1000);
      }
    } else {
      sim.addTrigger(1, 'short', 1000);
    }

    const result = sim.run();

    return res.status(200).json({
      success: true,
      platform: 'Vercel Serverless (JavaScript Demo Engine)',
      executionMode: 'JavaScript demonstration (NOT native C++ core)',
      warning: 'This execution used the ephemeral JavaScript demo engine. For authoritative native C++ simulation, target the Render backend.',
      traceEvents: result.traceEvents,
      summary: result.summary
    });
  } catch (err) {
    return res.status(500).json({ error: `Simulation execution failed: ${err.message}` });
  }
}
