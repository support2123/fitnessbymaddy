const { sendTemplate, sendText, canSendMessage } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, type, template, params, text } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone required' });

  try {
    const allowed = await canSendMessage(phone);
    if (!allowed) {
      return res.status(429).json({ error: 'Rate limited — max 1 msg per 2 hrs' });
    }

    let result;
    if (type === 'template' && template) {
      result = await sendTemplate(phone, template, params || []);
    } else if (type === 'text' && text) {
      result = await sendText(phone, text);
    } else {
      return res.status(400).json({ error: 'Provide type=template+template or type=text+text' });
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Failed to send' });
  }
};
