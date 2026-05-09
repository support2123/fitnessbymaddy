const { sendTemplate, sendText } = require('./lib/whatsapp');
const { canSendToLead, isOptedOut } = require('./lib/rate-limit');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, type, templateName, params, text, isClient } = req.body;

  if (!phone) {
    return res.status(400).json({ error: 'Phone number required' });
  }

  if (await isOptedOut(phone)) {
    return res.status(200).json({ status: 'skipped', reason: 'opted_out' });
  }

  if (!isClient && !(await canSendToLead(phone))) {
    return res.status(200).json({ status: 'skipped', reason: 'rate_limited' });
  }

  let result;
  if (type === 'template' && templateName) {
    result = await sendTemplate(phone, templateName, params || []);
  } else if (type === 'text' && text) {
    result = await sendText(phone, text);
  } else {
    return res.status(400).json({ error: 'Specify type=template with templateName, or type=text with text' });
  }

  return res.status(result.ok ? 200 : 500).json(result);
};
