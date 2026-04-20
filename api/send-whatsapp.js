import { sendTemplate, sendText, sendMediaTemplate } from '../lib/whatsapp.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, template_name, params, message, pdf_url } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    let result;

    if (type === 'template') {
      if (!template_name) return res.status(400).json({ error: 'Missing template_name' });
      result = await sendTemplate(phone, template_name, params || []);
    } else if (type === 'media') {
      if (!template_name || !pdf_url) return res.status(400).json({ error: 'Missing template_name or pdf_url' });
      result = await sendMediaTemplate(phone, template_name, pdf_url, params || []);
    } else if (type === 'text') {
      if (!message) return res.status(400).json({ error: 'Missing message' });
      result = await sendText(phone, message);
    } else {
      return res.status(400).json({ error: 'Invalid type. Use: template, media, or text' });
    }

    return res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
