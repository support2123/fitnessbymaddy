import { sendTemplate, checkRateLimitForLead } from '../lib/whatsapp.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template, params, mediaUrl, skipRateLimit } = req.body;

    if (!phone || !template) {
      return res.status(400).json({ error: 'Missing phone or template' });
    }

    if (!skipRateLimit) {
      const limited = await checkRateLimitForLead(phone);
      if (limited) {
        return res.status(429).json({ error: 'Rate limited', retryAfter: '2h' });
      }
    }

    const result = await sendTemplate(phone, template, params || [], mediaUrl || null);

    return res.status(result.sent ? 200 : 502).json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
