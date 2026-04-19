const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { getNudgeMsg } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = getSupabase();

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: leads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', sevenDaysAgo)
      .gte('created_at', fourteenDaysAgo);

    if (!leads || leads.length === 0) {
      return res.json({ success: true, message: 'No leads to nudge', nudged: 0 });
    }

    let nudged = 0;
    const baseUrl = process.env.VERCEL_PROJECT_URL || 'fitnessbymaddy.com';
    const trialUrl = `https://${baseUrl}/shred.html`;

    for (const lead of leads) {
      try {
        const { count } = await supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'nudge_reengagement');

        if ((count || 0) > 0) continue;

        const market = lead.market || 'GLOBAL';
        const msg = getNudgeMsg(market) + trialUrl;

        await sendWhatsApp(lead.phone, msg, 'nudge_reengagement');
        nudged++;
      } catch (leadErr) {
        console.error('Nudge failed:', leadErr.message);
      }
    }

    // Also nudge active clients with pending check-ins (24hr + 48hr)
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let checkinNudges = 0;

    if (activeClients) {
      for (const client of activeClients) {
        try {
          const programStart = new Date(client.program_started_at);
          const now = new Date();
          const daysDiff = Math.floor((now - programStart) / (1000 * 60 * 60 * 24));
          const weekNo = Math.ceil(daysDiff / 7);

          const { data: existing } = await supabase
            .from('checkins')
            .select('id')
            .eq('client_id', client.id)
            .eq('week_no', weekNo)
            .maybeSingle();

          if (existing) continue;

          const dayOfWeek = now.getDay();
          if (dayOfWeek !== 1 && dayOfWeek !== 2) continue;

          const checkinUrl = `https://${baseUrl}/checkin.html?c=${client.id}&w=${weekNo}`;

          await sendWhatsApp(
            client.phone,
            `Reminder: Your Week ${weekNo} check-in is still pending! Submit it here: ${checkinUrl}`
          );

          checkinNudges++;
        } catch (e) {
          console.error('Checkin nudge failed:', e.message);
        }
      }
    }

    return res.json({ success: true, nudged, checkin_nudges: checkinNudges });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
