const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, canSend } = require('../../lib/whatsapp');
const { isHinglish, detectMarket, maskPhone } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers['authorization'];
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;
  if (!isCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString();

    const { data: newLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .eq('opted_out', false)
      .lte('last_msg_at', twoHoursAgo)
      .gte('last_msg_at', twentyFourHoursAgo);

    let nudged = 0;

    if (newLeads) {
      for (const lead of newLeads) {
        if (!(await canSend(lead.phone, false))) continue;

        const market = detectMarket(lead.phone);
        await sendTemplate(lead.phone, 'nudge_trial', [
          lead.name || 'there'
        ]);
        nudged++;
      }
    }

    const { data: staleLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .eq('opted_out', false)
      .lte('last_msg_at', twentyFourHoursAgo);

    let dropped = 0;

    if (staleLeads) {
      for (const lead of staleLeads) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    const { data: reEngageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .eq('opted_out', false)
      .gte('last_msg_at', sevenDaysAgo);

    let reEngaged = 0;

    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        if (!(await canSend(lead.phone, false))) continue;

        const { count } = await db
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'reengage_7day');

        if (count && count > 0) continue;

        await sendTemplate(lead.phone, 'reengage_7day', [
          lead.name || 'there'
        ]);
        reEngaged++;
      }
    }

    console.log(`Nudge cron: ${nudged} nudged, ${dropped} dropped, ${reEngaged} re-engaged`);
    return res.status(200).json({ ok: true, nudged, dropped, reEngaged });
  } catch (err) {
    console.error('nudge-dropped cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
