// api/send-whatsapp.js — Internal WhatsApp sending helper endpoint

const { sendTemplate, sendText } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/utils');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://fitnessbymaddy.com',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-internal-key',
};

module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200, CORS_HEADERS);
    return res.end();
  }

  res.setHeader('Content-Type', 'application/json');
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // ── Auth check ──────────────────────────────────────────────────
    const internalKey = req.headers['x-internal-key'];
    if (!internalKey || internalKey !== process.env.INTERNAL_API_KEY) {
      console.warn('[send-whatsapp] Unauthorized request');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // ── Parse payload ───────────────────────────────────────────────
    const { phone, template, params, text } = req.body || {};

    if (!phone) {
      return res.status(400).json({ error: 'phone is required' });
    }

    if (!template && !text) {
      return res.status(400).json({ error: 'Either template or text must be provided' });
    }

    const masked = maskPhone(phone);

    let result;

    if (template) {
      console.log(`[send-whatsapp] Sending template "${template}" to ${masked}`);
      result = await sendTemplate(phone, template, params || []);
    } else {
      console.log(`[send-whatsapp] Sending text to ${masked}`);
      result = await sendText(phone, text);
    }

    if (!result.success) {
      console.error(`[send-whatsapp] Send failed for ${masked}:`, result.error);
      return res.status(502).json({ error: result.error || 'Send failed' });
    }

    return res.status(200).json({
      success: true,
      messageId: result.data?.messageId || null,
    });
  } catch (err) {
    console.error('[send-whatsapp] Unhandled error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
