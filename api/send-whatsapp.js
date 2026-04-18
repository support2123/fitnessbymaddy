const { getSupabase } = require('../lib/supabase');
const { sendTemplate, sendText, maskPhone, RATE_LIMIT_MS } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization || '';
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const { phone, template_name, params, text, force } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Phone required' });
    }

    if (!force) {
      const { data: lastOut } = await db
        .from('messages')
        .select('sent_at')
        .eq('phone', phone)
        .eq('direction', 'out')
        .order('sent_at', { ascending: false })
        .limit(1)
        .single();

      if (lastOut && (Date.now() - new Date(lastOut.sent_at).getTime()) < RATE_LIMIT_MS) {
        return res.status(429).json({
          error: 'Rate limited',
          next_allowed: new Date(new Date(lastOut.sent_at).getTime() + RATE_LIMIT_MS).toISOString(),
        });
      }
    }

    const { data: lead } = await db
      .from('leads')
      .select('status')
      .eq('phone', phone)
      .single();

    if (lead && lead.status === 'dropped') {
      return res.status(403).json({ error: 'Contact opted out' });
    }

    let result;
    if (template_name) {
      result = await sendTemplate(phone, template_name, params || []);
    } else if (text) {
      result = await sendText(phone, text);
    } else {
      return res.status(400).json({ error: 'template_name or text required' });
    }

    await db.from('messages').insert({
      phone,
      direction: 'out',
      body: text || `Template: ${template_name}`,
      template_name: template_name || null,
      sent_at: new Date().toISOString(),
      status: 'sent',
    });

    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error(`Send WA error for ${maskPhone(req.body?.phone)}:`, err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
