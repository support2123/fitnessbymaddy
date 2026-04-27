import { sendTemplate, sendText } from '../lib/whatsapp.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = req.headers['x-internal-key'];
  if (auth !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, type, template, text, params } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone required' });

  let result;
  if (type === 'template' && template) {
    result = await sendTemplate(phone, template, params || []);
  } else if (text) {
    result = await sendText(phone, text);
  } else {
    return res.status(400).json({ error: 'template or text required' });
  }

  return res.status(result.ok ? 200 : 429).json(result);
}
