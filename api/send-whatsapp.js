import supabase from '../lib/supabase.js';
import { sendTemplate, sendText, sendMediaMessage, canSendMessage } from '../lib/whatsapp.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_SECRET || process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, template_name, params, text, media_url, caption, force } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    if (!force) {
      const { data: lead } = await supabase
        .from('leads')
        .select('status, last_msg_at')
        .eq('phone', phone)
        .single();

      if (lead?.status === 'dropped') {
        return res.status(200).json({ skipped: true, reason: 'opted_out' });
      }

      const { data: client } = await supabase
        .from('clients')
        .select('status')
        .eq('phone', phone)
        .single();

      const isClient = client?.status === 'active';
      if (!isClient && lead && !canSendMessage(lead.last_msg_at)) {
        return res.status(200).json({ skipped: true, reason: 'rate_limited' });
      }
    }

    let result;
    switch (type) {
      case 'template':
        result = await sendTemplate(phone, template_name, params || []);
        break;
      case 'media':
        result = await sendMediaMessage(phone, media_url, caption);
        break;
      case 'text':
      default:
        result = await sendText(phone, text);
        break;
    }

    return res.status(200).json({ success: true, ...result });

  } catch (err) {
    console.error('Send WhatsApp error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
