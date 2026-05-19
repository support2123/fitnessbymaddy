const { getClient } = require('../lib/supabase');
const { sendTemplate, sendTextMessage } = require('../lib/whatsapp');
const { logMessage } = require('../lib/escalation');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getClient();

  try {
    const { phone, message, template_name, params } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    const cleaned = phone.replace(/\D/g, '');

    const { data: recent } = await db
      .from('messages')
      .select('sent_at')
      .eq('phone', cleaned)
      .eq('direction', 'out')
      .order('sent_at', { ascending: false })
      .limit(1)
      .single();

    if (recent) {
      const lastSent = new Date(recent.sent_at);
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

      const { data: isClient } = await db
        .from('clients')
        .select('id')
        .eq('phone', cleaned)
        .eq('status', 'active')
        .single();

      if (!isClient && lastSent > twoHoursAgo) {
        return res.status(429).json({
          error: 'Rate limited — max 1 message per 2 hours for non-clients',
          retry_after: Math.ceil((lastSent.getTime() + 2 * 60 * 60 * 1000 - Date.now()) / 1000),
        });
      }
    }

    let result;
    if (template_name) {
      result = await sendTemplate(cleaned, template_name, params || []);
      await logMessage(db, cleaned, 'out', null, template_name);
    } else if (message) {
      result = await sendTextMessage(cleaned, message);
      await logMessage(db, cleaned, 'out', message, null);
    } else {
      return res.status(400).json({ error: 'Missing message or template_name' });
    }

    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
