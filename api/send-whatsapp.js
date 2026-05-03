const { sendTemplate, sendTextMessage, maskPhone } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['x-api-key'];
  if (authHeader !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, type, templateName, params, text } = req.body;

  if (!phone) {
    return res.status(400).json({ error: 'Missing phone' });
  }

  try {
    let result;
    if (type === 'template') {
      result = await sendTemplate(phone, templateName, params || []);
    } else {
      result = await sendTextMessage(phone, text);
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error(`Send error for ${maskPhone(phone)}:`, err.message);
    return res.status(500).json({ error: 'Send failed' });
  }
};
