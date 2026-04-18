const { sendTemplate, sendText, canSendToLead } = require('../lib/whatsapp');
const { getClient } = require('../lib/supabase');
const { cors, parseBody, maskPhone } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY || process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = await parseBody(req);
  const { phone, template, params, text, force } = body;

  if (!phone) {
    return res.status(400).json({ error: 'Missing phone' });
  }

  // Rate limit check for leads (skip for force=true, used for active clients)
  if (!force) {
    const allowed = await canSendToLead(phone);
    if (!allowed) {
      console.log(`[RATE-LIMIT] ${maskPhone(phone)} — skipped`);
      return res.status(429).json({ error: 'Rate limited — max 1 msg per 2 hrs for leads' });
    }
  }

  let result;
  if (template) {
    result = await sendTemplate(phone, template, params || []);
  } else if (text) {
    result = await sendText(phone, text);
  } else {
    return res.status(400).json({ error: 'Provide template or text' });
  }

  console.log(`[WA-OUT] ${maskPhone(phone)} → ${template || 'text'}`);

  return res.status(result.ok ? 200 : 502).json(result);
};
