'use strict';

const { sendWhatsApp, maskPhone } = require('./lib/whatsapp');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

function isAuthorized(req) {
  const authHeader = req.headers['authorization'] || '';
  const secret = process.env.INTERNAL_API_SECRET || process.env.AISENSY_API_KEY;

  if (!secret) {
    // No secret configured — block all requests for safety
    console.error('[send-whatsapp] No INTERNAL_API_SECRET or AISENSY_API_KEY set');
    return false;
  }

  const expected = `Bearer ${secret}`;
  return authHeader === expected;
}

module.exports = async function handler(req, res) {
  // ── CORS preflight ──────────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return res.status(200).set(CORS_HEADERS).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Auth ──────────────────────────────────────────────────────────────
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const body     = req.body || {};
    const phone    = (body.phone || '').trim();
    const template = (body.template || '').trim();
    const params   = Array.isArray(body.params) ? body.params : [];
    const isClient = Boolean(body.isClient);

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }
    if (!template) {
      return res.status(400).json({ error: 'Missing template' });
    }

    console.log(
      `[send-whatsapp] Sending template="${template}" to ${maskPhone(phone)} isClient=${isClient}`
    );

    const result = await sendWhatsApp(phone, template, params, isClient);

    if (!result.success) {
      const status = result.reason === 'rate_limited' ? 429 : 502;
      return res.status(status).json({ success: false, reason: result.reason });
    }

    return res.status(200).json({ success: true, data: result.data });

  } catch (err) {
    console.error('[send-whatsapp] Unhandled error:', err.message);
    return res.status(500).json({ success: false, error: 'internal_error' });
  }
};
