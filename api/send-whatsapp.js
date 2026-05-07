import { sendTemplate, sendTextMessage, maskPhone } from './lib/whatsapp.js';
import { canSendMessage, logMessage } from './lib/rate-limit.js';
import { supabase } from './lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { phone, template, params, text, force } = req.body;

  if (!phone) {
    return res.status(400).json({ error: 'Missing phone' });
  }

  if (!force) {
    const { data: lead } = await supabase
      .from('leads')
      .select('status')
      .eq('phone', phone)
      .single();

    if (lead && lead.status === 'dropped') {
      return res.status(403).json({ error: 'Contact opted out' });
    }

    const canSend = await canSendMessage(phone);
    if (!canSend) {
      return res.status(429).json({ error: 'Rate limited — wait 2 hours between messages' });
    }
  }

  try {
    let result;
    if (template) {
      result = await sendTemplate(phone, template, params || []);
      await logMessage(phone, 'out', `Template: ${template}`, template);
    } else if (text) {
      result = await sendTextMessage(phone, text);
      await logMessage(phone, 'out', text);
    } else {
      return res.status(400).json({ error: 'Provide template or text' });
    }

    return res.status(200).json({ status: 'sent', result });
  } catch (err) {
    console.error(`Send failed to ${maskPhone(phone)}:`, err.message);
    return res.status(500).json({ error: 'Send failed' });
  }
}
