const { sendTemplate, sendText, maskPhone } = require('../lib/whatsapp');
const { logMessage, canSendTo, isOptedOut } = require('../lib/messages');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['x-internal-key'];
  if (authHeader !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template, params, text, force } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone required' });

    if (await isOptedOut(phone)) {
      return res.status(200).json({ status: 'skipped', reason: 'opted_out' });
    }

    if (!force && !(await canSendTo(phone))) {
      return res.status(200).json({ status: 'skipped', reason: 'rate_limited' });
    }

    let result;
    if (template) {
      result = await sendTemplate(phone, template, params || []);
      await logMessage(phone, 'out', `Template: ${template}`, template);
    } else if (text) {
      result = await sendText(phone, text);
      await logMessage(phone, 'out', text);
    } else {
      return res.status(400).json({ error: 'template or text required' });
    }

    console.log(`[SEND_WA] ${maskPhone(phone)} → ${template || 'text'}`);
    return res.status(200).json({ status: 'sent', result });
  } catch (err) {
    console.error('[SEND_WA]', err.message);
    return res.status(500).json({ error: 'Send failed' });
  }
};
