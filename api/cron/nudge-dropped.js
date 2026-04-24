const { getSupabase } = require('../../lib/supabase');
const { canSendMessage, sendTemplate, sendText } = require('../../lib/whatsapp');
const { isHinglish, detectMarket } = require('../../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const db = getSupabase();

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    // Re-engage leads dropped 7-14 days ago (not older)
    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lte('last_msg_at', sevenDaysAgo)
      .gte('last_msg_at', fourteenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ action: 'no_leads_to_nudge' });
    }

    let nudged = 0;

    for (const lead of droppedLeads) {
      const allowed = await canSendMessage(lead.phone, false);
      if (!allowed) continue;

      const { data: alreadyClient } = await db
        .from('clients')
        .select('id')
        .eq('phone', lead.phone)
        .limit(1)
        .single();

      if (alreadyClient) continue;

      const market = detectMarket(lead.phone);
      const hinglish = isHinglish(market);

      await sendTemplate(lead.phone, 'nudge_trial', [lead.name || 'there']);

      await db.from('leads').update({
        last_msg_at: new Date().toISOString()
      }).eq('id', lead.id);

      nudged++;
    }

    // Nudge active clients who haven't submitted check-ins
    const { data: pendingClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let checkinNudges = 0;

    if (pendingClients) {
      for (const client of pendingClients) {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSinceStart / 7);
        const dayOfWeek = now.getDay();

        // Nudge on Monday (1 day after Sunday send) and Tuesday (2 days after)
        if (dayOfWeek !== 1 && dayOfWeek !== 2) continue;

        const { data: thisWeekCheckin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .single();

        if (thisWeekCheckin) continue;

        const allowed = await canSendMessage(client.phone, true);
        if (!allowed) continue;

        const market = detectMarket(client.phone);
        const hinglish = isHinglish(market);
        const formUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;

        const msg = hinglish
          ? `Reminder: Week ${currentWeek} ka check-in abhi tak pending hai. Yahan fill karo: ${formUrl}`
          : `Reminder: Your Week ${currentWeek} check-in is still pending: ${formUrl}`;

        await sendText(client.phone, msg);
        checkinNudges++;
      }
    }

    return res.status(200).json({ action: 'nudge_complete', leads_nudged: nudged, checkin_nudges: checkinNudges });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
