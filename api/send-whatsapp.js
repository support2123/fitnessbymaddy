import { sendTemplate, sendFreeform } from './lib/whatsapp.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template, params, message, isClient } = req.body;
    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    let result;
    if (template) {
      result = await sendTemplate(phone, template, params || [], !!isClient);
    } else if (message) {
      result = await sendFreeform(phone, message, !!isClient);
    } else {
      return res.status(400).json({ error: 'Provide template or message' });
    }

    return res.json({ success: true, result });
  } catch (err) {
    console.error('Send WhatsApp error:', err);
    return res.status(500).json({ error: 'Failed to send message' });
  }
}
