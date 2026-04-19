import { sendWhatsApp } from '../lib/whatsapp.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  const expectedKey = process.env.INTERNAL_API_KEY;
  if (expectedKey && authHeader !== `Bearer ${expectedKey}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, body, template, bypass_rate_limit } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }
    if (!body && !template) {
      return res.status(400).json({ error: 'Missing body or template' });
    }

    const result = await sendWhatsApp(phone, body, template, !!bypass_rate_limit);
    return res.status(200).json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
