const db = require('./_lib/supabase');
const wa = require('./_lib/whatsapp');
const { maskPhone, cors } = require('./_lib/utils');

const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { phone, template_name, params, user_name, media_url, force } = req.body;

    if (!phone || !template_name) {
      return res.status(400).json({ error: 'phone and template_name required' });
    }

    if (!force) {
      const recentMsgs = await db.query(
        'messages',
        `phone=eq.${phone}&direction=eq.out&order=sent_at.desc&limit=1&select=sent_at`
      );

      if (recentMsgs.length > 0) {
        const lastSent = new Date(recentMsgs[0].sent_at).getTime();
        const now = Date.now();
        if (now - lastSent < RATE_LIMIT_MS) {
          const waitMins = Math.ceil((RATE_LIMIT_MS - (now - lastSent)) / 60000);
          return res.status(429).json({
            error: 'Rate limited',
            retry_after_minutes: waitMins,
          });
        }
      }
    }

    const droppedLeads = await db.query('leads', `phone=eq.${phone}&status=eq.dropped&select=id`);
    if (droppedLeads.length > 0) {
      return res.status(403).json({ error: 'Lead opted out — do not message' });
    }

    let result;
    if (media_url) {
      result = await wa.sendMediaTemplate(phone, template_name, media_url, params || [], user_name || 'there');
    } else {
      result = await wa.sendTemplate(phone, template_name, params || [], user_name || 'there');
    }

    await db.insert('messages', {
      phone,
      direction: 'out',
      body: (params || []).join(' | '),
      template_name,
      sent_at: new Date().toISOString(),
      status: 'sent',
    });

    return res.status(200).json({ ok: true, result });
  } catch (err) {
    console.error(`Send WA error to ${maskPhone(req.body?.phone)}:`, err.message);
    return res.status(500).json({ error: 'Send failed' });
  }
};
