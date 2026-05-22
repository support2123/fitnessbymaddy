import { sendWhatsApp } from './_lib/whatsapp.js';
import { handleCors, parseBody } from './_lib/utils.js';

export default async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const auth = req.headers.authorization;
  if (auth !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, template, params } = parseBody(req);

  if (!phone || !template) {
    return res.status(400).json({ error: 'Missing phone or template' });
  }

  const result = await sendWhatsApp(phone, template, params || []);
  return res.json(result);
}
