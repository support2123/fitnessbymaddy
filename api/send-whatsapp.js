const { sendTemplate, sendText } = require('../lib/whatsapp');
const { parseBody } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, template, params, text } = await parseBody(req);

    if (!phone) {
      return res.status(400).json({ error: 'phone is required' });
    }

    let result;
    if (type === 'template' && template) {
      result = await sendTemplate(phone, template, params || []);
    } else if (type === 'text' && text) {
      result = await sendText(phone, text);
    } else {
      return res.status(400).json({ error: 'Provide type=template with template name, or type=text with text' });
    }

    return res.status(result.success ? 200 : 429).json(result);
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
