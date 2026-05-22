const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && req.headers['x-vercel-cron'] !== '1') {
    if (req.headers['x-internal-key'] !== process.env.SUPABASE_SERVICE_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    const db = getSupabase();
    const now = new Date();

    // Nudge leads who haven't replied in 2 hours (new leads only)
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // 2-hour nudge for new leads
    const { data: newLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', twentyFourHoursAgo);

    let nudged = 0;
    let dropped = 0;

    if (newLeads) {
      for (const lead of newLeads) {
        const { data: msgs } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'nudge_trial')
          .limit(1);

        if (msgs && msgs.length > 0) continue;

        const hinglish = isHinglish(lead.market || 'IN');
        const msg = hinglish
          ? 'Maddy ke $20 trial session try karo — 1 Zoom call mein pata chalega ki kaunsa program best hai. Book karo: https://www.fitnessbymaddy.com/shred.html'
          : 'Try Maddy\'s $20 trial session — one Zoom call to find your perfect program. Book here: https://www.fitnessbymaddy.com/shred.html';

        await sendWhatsApp({
          phone: lead.phone,
          templateName: 'nudge_trial',
          body: msg
        });
        nudged++;
      }
    }

    // 24-hour drop for unresponsive leads
    const { data: staleLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twentyFourHoursAgo)
      .gt('created_at', sevenDaysAgo);

    if (staleLeads) {
      for (const lead of staleLeads) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    // 7-day re-engagement for dropped leads
    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo);

    // Don't re-engage these — respect the 7-day rule, just count them
    const droppedOld = droppedLeads?.length || 0;

    return res.status(200).json({ ok: true, nudged, dropped, droppedOld });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
