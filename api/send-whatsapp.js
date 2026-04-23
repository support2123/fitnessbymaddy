import { sendTemplate, sendSessionMessage } from './lib/whatsapp.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, template_name, template_params, user_name, message } = req.body;
    if (!phone) return res.status(400).json({ error: 'phone required' });

    let result;
    if (type === 'template' && template_name) {
      result = await sendTemplate(phone, template_name, template_params, user_name);
    } else if (type === 'session' && message) {
      result = await sendSessionMessage(phone, message);
    } else {
      return res.status(400).json({ error: 'Invalid type. Use "template" or "session"' });
    }

    return res.status(result.ok ? 200 : 500).json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
