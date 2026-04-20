import { sendWhatsApp } from './_lib/whatsapp.js';
import { maskPhone } from './_lib/mask.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template, params = [], isClient = false } = req.body;

    if (!phone || !template) {
      return res.status(400).json({ error: 'Missing phone or template' });
    }

    const result = await sendWhatsApp(phone, template, params, isClient);

    if (!result.ok) {
      console.log(`Send failed for ${maskPhone(phone)}: ${result.reason || 'unknown'}`);
    }

    return res.status(result.ok ? 200 : 429).json(result);
  } catch (err) {
    console.error(`Send error: ${err.message}`);
    return res.status(500).json({ error: 'Internal error' });
  }
}
