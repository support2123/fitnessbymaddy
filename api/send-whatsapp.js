import { sendWhatsApp } from '../lib/whatsapp.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, templateName, body, isClient } = req.body;

    if (!phone || (!templateName && !body)) {
      return res.status(400).json({ error: 'phone and (templateName or body) required' });
    }

    const result = await sendWhatsApp({
      phone,
      templateName: templateName || 'manual_message',
      body,
      isClient: !!isClient
    });

    return res.status(200).json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
