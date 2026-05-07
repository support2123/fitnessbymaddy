import { sendTemplate, sendText, sendDocument } from '../lib/whatsapp.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY || process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, template_name, params, text, document_url, caption } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone number' });
    }

    let result;

    switch (type) {
      case 'template':
        if (!template_name) {
          return res.status(400).json({ error: 'Missing template_name for template type' });
        }
        result = await sendTemplate(phone, template_name, params || []);
        break;

      case 'text':
        if (!text) {
          return res.status(400).json({ error: 'Missing text for text type' });
        }
        result = await sendText(phone, text);
        break;

      case 'document':
        if (!document_url) {
          return res.status(400).json({ error: 'Missing document_url for document type' });
        }
        result = await sendDocument(phone, document_url, caption || '');
        break;

      default:
        return res.status(400).json({ error: 'Invalid type. Use: template, text, or document' });
    }

    if (!result.ok && result.reason === 'rate_limited') {
      return res.status(429).json({ error: 'Rate limited', reason: result.reason });
    }

    return res.status(200).json({ success: result.ok, data: result.data });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
