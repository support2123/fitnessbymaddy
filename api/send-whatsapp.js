import { sendTemplate, sendSessionMessage } from './_lib/whatsapp.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, type, templateName, params, message } = req.body;

  if (!phone) {
    return res.status(400).json({ error: 'phone is required' });
  }

  try {
    let result;
    if (type === 'template') {
      if (!templateName) {
        return res.status(400).json({ error: 'templateName is required for template messages' });
      }
      result = await sendTemplate(phone, templateName, params || []);
    } else {
      if (!message) {
        return res.status(400).json({ error: 'message is required for session messages' });
      }
      result = await sendSessionMessage(phone, message);
    }

    return res.status(result.ok ? 200 : 429).json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Failed to send message' });
  }
}
