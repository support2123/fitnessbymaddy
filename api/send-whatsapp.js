const { sendMessage } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, template, params, text, isClient } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone required' });
  if (!template && !text) return res.status(400).json({ error: 'template or text required' });

  try {
    const result = await sendMessage(phone, { template, params, text, isClient });
    return res.status(200).json(result);
  } catch (err) {
    console.error('send-whatsapp error:', err.message);
    return res.status(500).json({ error: 'Failed to send message' });
  }
};
