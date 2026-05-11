import { sendTemplate, sendText, sendDocument } from '../lib/whatsapp.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, template_name, params, text, pdf_url, caption, is_client } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    let result;

    switch (type) {
      case 'template':
        if (!template_name) return res.status(400).json({ error: 'Missing template_name' });
        result = await sendTemplate(phone, template_name, params || [], !!is_client);
        break;
      case 'text':
        if (!text) return res.status(400).json({ error: 'Missing text' });
        result = await sendText(phone, text, !!is_client);
        break;
      case 'document':
        if (!pdf_url) return res.status(400).json({ error: 'Missing pdf_url' });
        result = await sendDocument(phone, pdf_url, caption || '', !!is_client);
        break;
      default:
        return res.status(400).json({ error: 'Invalid type. Use: template, text, or document' });
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
