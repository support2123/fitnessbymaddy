const { supabase } = require('../lib/supabase');
const { sendTemplate, sendText } = require('../lib/whatsapp');
const { corsHeaders, maskPhone } = require('../lib/utils');

const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, template, params, text, force } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });
    if (!template && !text) return res.status(400).json({ error: 'template or text required' });

    const { data: lead } = await supabase
      .from('leads')
      .select('status')
      .eq('phone', phone)
      .single();

    if (lead?.status === 'dropped') {
      return res.status(403).json({ error: 'Lead opted out' });
    }

    if (!force) {
      const { data: recentMsg } = await supabase
        .from('messages')
        .select('sent_at')
        .eq('phone', phone)
        .eq('direction', 'out')
        .order('sent_at', { ascending: false })
        .limit(1)
        .single();

      if (recentMsg) {
        const elapsed = Date.now() - new Date(recentMsg.sent_at).getTime();
        if (elapsed < RATE_LIMIT_MS) {
          const waitMin = Math.ceil((RATE_LIMIT_MS - elapsed) / 60000);
          return res.status(429).json({
            error: 'Rate limited',
            retry_after_minutes: waitMin
          });
        }
      }
    }

    let result;
    if (template) {
      result = await sendTemplate(phone, template, params || []);
    } else {
      result = await sendText(phone, text);
    }

    console.log(`Sent to ${maskPhone(phone)}: ${template || 'text'}`);
    return res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    console.error('Send error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
