const { getSupabase } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');
const { detectMarket, isHinglish } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const sb = getSupabase();

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await sb
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', oneDayAgo)
      .gte('created_at', sevenDaysAgo);

    if (!newLeads || newLeads.length === 0) {
      return res.status(200).json({ ok: true, marked: 0, nudged: 0 });
    }

    let nudged = 0;
    let marked = 0;

    for (const lead of newLeads) {
      const createdAt = new Date(lead.created_at);
      const hoursSinceCreation = (Date.now() - createdAt) / (1000 * 60 * 60);

      if (hoursSinceCreation > 24 * 7) {
        continue;
      }

      if (hoursSinceCreation >= 24 && hoursSinceCreation < 48) {
        await sb.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        marked++;
        continue;
      }

      if (hoursSinceCreation >= 48 && hoursSinceCreation < 72) {
        const market = detectMarket(lead.phone);
        await sendTemplate(lead.phone, 'reengagement_v1', [lead.name || 'there']);
        nudged++;
      }
    }

    const { data: droppedLeads } = await sb
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('created_at', sevenDaysAgo);

    for (const lead of (droppedLeads || [])) {
      const droppedHoursAgo = (Date.now() - new Date(lead.last_msg_at || lead.created_at)) / (1000 * 60 * 60);

      if (droppedHoursAgo >= 72 && droppedHoursAgo < 96) {
        await sendTemplate(lead.phone, 'last_chance_v1', [lead.name || 'there']);
        nudged++;
      }
    }

    return res.status(200).json({ ok: true, marked, nudged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
