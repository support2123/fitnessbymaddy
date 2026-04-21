const { sendRateLimited, sendText } = require('./lib/whatsapp');
const { getSupabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template_name, params, message, user_name, force } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    let isClient = false;
    if (force) {
      isClient = true;
    } else {
      const db = getSupabase();
      const { data } = await db
        .from('clients')
        .select('id')
        .eq('phone', phone)
        .eq('status', 'active')
        .single();
      isClient = !!data;
    }

    if (template_name) {
      const result = await sendRateLimited(phone, template_name, params || [], user_name, isClient);
      return res.status(200).json(result);
    }

    if (message) {
      const result = await sendText(phone, message);
      return res.status(200).json({ success: true, result });
    }

    return res.status(400).json({ error: 'template_name or message required' });
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Failed to send message' });
  }
};
