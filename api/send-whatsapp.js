const { sendTemplate, sendText, sendDocument } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, type, templateName, params, message, documentUrl, caption } = req.body;

  if (!phone) return res.status(400).json({ error: 'phone required' });

  try {
    let result;

    if (type === 'template') {
      result = await sendTemplate(phone, templateName, params || []);
    } else if (type === 'document') {
      result = await sendDocument(phone, documentUrl, caption);
    } else {
      result = await sendText(phone, message);
    }

    console.log(`Sent ${type || 'text'} to ${maskPhone(phone)}: ${result.ok ? 'OK' : 'FAIL'}`);
    return res.status(200).json(result);
  } catch (err) {
    console.error(`Send failed for ${maskPhone(phone)}:`, err.message);
    return res.status(500).json({ error: err.message });
  }
};
