const { sendTemplate, sendTextMessage } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, template, params, text } = req.body;

  if (!phone) return res.status(400).json({ error: 'phone required' });

  let result;
  if (template) {
    result = await sendTemplate(phone, template, params || []);
  } else if (text) {
    result = await sendTextMessage(phone, text);
  } else {
    return res.status(400).json({ error: 'template or text required' });
  }

  if (result.rateLimited) {
    return res.status(429).json({ error: 'Rate limited', result });
  }

  return res.status(200).json({ success: true, result });
};
