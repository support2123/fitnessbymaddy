const { sendTemplate, sendText, sendDocument, checkRateLimit } = require('./_lib/whatsapp');
const { corsHeaders } = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${process.env.INTERNAL_API_KEY || process.env.SUPABASE_SERVICE_KEY}`) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const body = req.body || {};
    const { phone, type, template_name, params, message, document_url, caption, skip_rate_limit } = body;

    if (!phone) return res.status(400).json({ error: 'missing phone' });

    if (!skip_rate_limit) {
      const canSend = await checkRateLimit(phone);
      if (!canSend) {
        return res.status(429).json({ error: 'rate_limited', message: 'Max 1 message per 2 hours for leads' });
      }
    }

    let result;
    if (type === 'template') {
      result = await sendTemplate(phone, template_name, params || []);
    } else if (type === 'document') {
      result = await sendDocument(phone, document_url, caption);
    } else {
      result = await sendText(phone, message);
    }

    return res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    console.error('[SEND-WA ERROR]', err.message);
    return res.status(500).json({ error: 'internal_error' });
  }
};
