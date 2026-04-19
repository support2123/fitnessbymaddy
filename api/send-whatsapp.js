import { sendTemplate, sendSessionMessage } from '../lib/whatsapp.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = req.headers.authorization;
  if (auth !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template, params, message, is_client } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    let result;

    if (template) {
      result = await sendTemplate(phone, template, params || [], !!is_client);
    } else if (message) {
      result = await sendSessionMessage(phone, message);
    } else {
      return res.status(400).json({ error: 'template or message required' });
    }

    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
