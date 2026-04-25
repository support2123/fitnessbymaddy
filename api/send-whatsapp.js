import { getSupabase } from './_lib/supabase.js';
import { sendTemplate, sendClientMessage } from './_lib/whatsapp.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = req.headers.authorization;
  if (auth !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const { phone, template, params, isClient } = req.body;

    if (!phone || !template) {
      return res.status(400).json({ error: 'phone and template required' });
    }

    const result = isClient
      ? await sendClientMessage(phone, template, params || [])
      : await sendTemplate(phone, template, params || []);

    await db.from('messages').insert({
      phone,
      direction: 'out',
      body: `[Template: ${template}] ${(params || []).join(', ')}`.slice(0, 1000),
      template_name: template,
      status: result.ok ? 'sent' : 'failed'
    });

    return res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    console.error('send-whatsapp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
