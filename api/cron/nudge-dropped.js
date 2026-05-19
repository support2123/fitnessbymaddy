const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const now = new Date();
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000);
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

    // Nudge new leads who haven't replied in 2 hours
    const { data: staleNew } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo.toISOString())
      .gt('created_at', twentyFourHoursAgo.toISOString());

    let nudged = 0;
    if (staleNew) {
      for (const lead of staleNew) {
        const { data: recentMsg } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'nudge_trial')
          .single();

        if (recentMsg) continue;

        await sendWhatsApp({
          phone: lead.phone,
          templateName: 'nudge_trial',
          params: [lead.name || 'there', 'https://fitnessbymaddy.com/program-trial.html']
        });
        nudged++;
      }
    }

    // Drop leads with no reply after 24 hours
    const { data: deadLeads } = await db
      .from('leads')
      .select('id, phone, last_msg_at')
      .eq('status', 'new')
      .lt('created_at', twentyFourHoursAgo.toISOString());

    let dropped = 0;
    if (deadLeads) {
      for (const lead of deadLeads) {
        const { data: inbound } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .gt('sent_at', lead.last_msg_at || lead.created_at)
          .limit(1)
          .single();

        if (!inbound) {
          await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
          dropped++;
        }
      }
    }

    // Re-engage dropped leads within 7-day window (one-time)
    const { data: reEngageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gt('created_at', sevenDaysAgo.toISOString());

    let reEngaged = 0;
    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        const { data: alreadySent } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'reengage_7day')
          .single();

        if (alreadySent) continue;

        await sendWhatsApp({
          phone: lead.phone,
          templateName: 'reengage_7day',
          params: [lead.name || 'there']
        });
        reEngaged++;
      }
    }

    return res.json({ ok: true, nudged, dropped, reEngaged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
