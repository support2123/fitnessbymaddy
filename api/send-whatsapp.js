import { sendTemplate, sendText, sendMedia } from './lib/whatsapp.js';
import { canSendMessage, logMessage, isOptedOut } from './lib/rate-limit.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, template_name, message, media_url, caption, params, skip_rate_limit } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const optedOut = await isOptedOut(phone);
    if (optedOut) return res.status(200).json({ status: 'opted_out' });

    if (!skip_rate_limit) {
      const allowed = await canSendMessage(phone);
      if (!allowed) return res.status(429).json({ error: 'Rate limited — max 1 msg per 2 hrs' });
    }

    let result;

    if (type === 'template') {
      result = await sendTemplate(phone, template_name, params || []);
      await logMessage(phone, 'out', `Template: ${template_name}`, template_name);
    } else if (type === 'media') {
      result = await sendMedia(phone, media_url, caption || '');
      await logMessage(phone, 'out', caption || media_url, 'media');
    } else {
      result = await sendText(phone, message);
      await logMessage(phone, 'out', message);
    }

    return res.status(200).json({ status: 'sent', result });
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
