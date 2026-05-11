const { getClient } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { isHinglish, detectMarket, maskPhone } = require('../../lib/market');

const REENGAGEMENT_WINDOW_DAYS = 7;
const MIN_DAYS_SINCE_DROP = 3;

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    if (req.method !== 'GET' && req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  }

  const sb = getClient();

  const maxAge = new Date(Date.now() - REENGAGEMENT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const minAge = new Date(Date.now() - MIN_DAYS_SINCE_DROP * 24 * 60 * 60 * 1000).toISOString();

  const { data: droppedLeads } = await sb
    .from('leads')
    .select('*')
    .eq('status', 'dropped')
    .gte('last_msg_at', maxAge)
    .lte('last_msg_at', minAge);

  if (!droppedLeads || droppedLeads.length === 0) {
    return res.status(200).json({ ok: true, message: 'No leads to re-engage', sent: 0 });
  }

  const { data: alreadyNudged } = await sb
    .from('messages')
    .select('phone')
    .eq('template_name', 'nudge_reengage')
    .in('phone', droppedLeads.map(l => l.phone));

  const nudgedPhones = new Set((alreadyNudged || []).map(m => m.phone));

  let sent = 0;
  for (const lead of droppedLeads) {
    if (nudgedPhones.has(lead.phone)) continue;

    try {
      const hinglish = isHinglish(detectMarket(lead.phone));

      await sendTemplate(lead.phone, 'nudge_reengage', {
        name: lead.name || 'there',
        templateParams: [
          lead.name || 'there',
          'https://www.fitnessbymaddy.com/shred.html'
        ]
      });

      sent++;
    } catch (err) {
      console.error(`Nudge failed for ${maskPhone(lead.phone)}:`, err.message);
    }
  }

  return res.status(200).json({ ok: true, sent, total: droppedLeads.length });
};
