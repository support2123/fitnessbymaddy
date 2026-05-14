import { sendText, sendTemplate, sendMediaMessage } from './lib/whatsapp.js';
import { maskPhone } from './lib/market.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, message, template, params, mediaUrl, caption } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone is required' });

    let result;

    if (type === 'template' && template) {
      result = await sendTemplate(phone, template, params || []);
    } else if (type === 'media' && mediaUrl) {
      result = await sendMediaMessage(phone, mediaUrl, caption || '');
    } else if (message) {
      result = await sendText(phone, message);
    } else {
      return res.status(400).json({ error: 'Provide message, template, or mediaUrl' });
    }

    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error('Send WhatsApp error:', maskPhone(req.body?.phone || ''), err.message);
    return res.status(500).json({ error: 'Failed to send message' });
  }
}
