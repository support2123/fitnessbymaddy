const { sendTemplate, sendText, canSendMessage } = require('./_lib/whatsapp');
const { supabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, template, params, text } = req.body;
  if (!phone) return res.status(400).json({ error: 'Missing phone' });

  try {
    const { data: lead } = await supabase.from('leads').select('opted_out').eq('phone', phone).single();
    if (lead?.opted_out) return res.status(200).json({ skipped: true, reason: 'opted_out' });

    const { data: client } = await supabase.from('clients').select('id').eq('phone', phone).single();
    const isClient = !!client;

    const canSend = await canSendMessage(phone, isClient);
    if (!canSend) return res.status(429).json({ error: 'Rate limited — 1 msg per 2hrs for non-clients' });

    let result;
    if (template) {
      result = await sendTemplate(phone, template, params || []);
    } else if (text) {
      result = await sendText(phone, text);
    } else {
      return res.status(400).json({ error: 'Provide template or text' });
    }

    return res.status(200).json({ sent: true, result });
  } catch (err) {
    console.error('Send error:', err.message);
    return res.status(500).json({ error: 'Failed to send' });
  }
};
