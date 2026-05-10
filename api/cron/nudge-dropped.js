const supabase = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');
const { isHinglish } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    // Re-engage leads dropped 7-14 days ago (one-time nudge window)
    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lte('last_msg_at', sevenDaysAgo)
      .gte('last_msg_at', fourteenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.json({ nudged: 0 });
    }

    let nudged = 0;

    for (const lead of droppedLeads) {
      // Check if we already sent a nudge (prevent repeat nudges)
      const { count } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('template_name', 'nudge_reengagement')
        .eq('direction', 'out');

      if (count && count > 0) continue;

      const hin = isHinglish(lead.market);

      const msg = hin
        ? `Hey! Maddy ka $20 zoom trial abhi bhi available hai. Ek session mein hi feel karoge ki yeh kaam karega ya nahi. Interest hai toh reply karo!`
        : `Hey! Maddy's $20 zoom trial is still available. One session to see if this is the right fit for you. Reply if interested!`;

      await sendTemplate(lead.phone, 'nudge_reengagement', [msg]);
      nudged++;
    }

    // Also nudge active clients who haven't submitted check-in
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let clientNudges = 0;

    if (activeClients) {
      for (const client of activeClients) {
        const startDate = new Date(client.program_started_at);
        const weekNo = Math.ceil((Date.now() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000));

        const { data: checkin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .maybeSingle();

        if (checkin) continue;

        // Check days since Sunday (last check-in prompt)
        const now = new Date();
        const dayOfWeek = now.getDay();
        const daysSinceSunday = dayOfWeek === 0 ? 7 : dayOfWeek;

        if (daysSinceSunday === 1 || daysSinceSunday === 2) {
          const { data: lead } = client.lead_id
            ? await supabase.from('leads').select('market').eq('id', client.lead_id).maybeSingle()
            : { data: null };

          const market = lead?.market || 'GLOBAL';
          const formUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

          const msg = isHinglish(market)
            ? `Reminder: Week ${weekNo} check-in abhi tak pending hai. Jaldi fill karo taaki hum tumhara next week ka plan bana sakein!`
            : `Reminder: Your Week ${weekNo} check-in is still pending. Complete it so we can prepare your next week's plan!`;

          await sendTemplate(client.phone, 'checkin_reminder', [msg, formUrl]);
          clientNudges++;
        }
      }
    }

    return res.json({ nudged, client_nudges: clientNudges });
  } catch (err) {
    console.error('Nudge cron error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
