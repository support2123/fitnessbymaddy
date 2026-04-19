const { sendTemplate, sendText } = require('../lib/whatsapp');
const { handleCors } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template, params, text } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    let result;
    if (template) {
      result = await sendTemplate(phone, template, params || []);
    } else if (text) {
      result = await sendText(phone, text);
    } else {
      return res.status(400).json({ error: 'template or text required' });
    }

    return res.status(result.success ? 200 : 500).json(result);
  } catch (err) {
    console.error('[SendWhatsApp] Error:', err.message);
    return res.status(500).json({ error: 'Send failed' });
  }
};
