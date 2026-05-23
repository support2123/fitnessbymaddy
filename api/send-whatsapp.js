const { sendWhatsApp, sendFreeformWhatsApp } = require('../lib/whatsapp');
const { parseBody, corsHeaders } = require('../lib/utils');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = await parseBody(req);
  const { phone, template, params, message } = body;

  if (!phone) return res.status(400).json({ error: 'Missing phone' });

  if (template) {
    const result = await sendWhatsApp(phone, template, params || []);
    return res.status(result.ok ? 200 : 500).json(result);
  }

  if (message) {
    const result = await sendFreeformWhatsApp(phone, message);
    return res.status(result.ok ? 200 : 500).json(result);
  }

  return res.status(400).json({ error: 'Provide template or message' });
};
