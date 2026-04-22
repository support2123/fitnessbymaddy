const { supabase } = require('../_lib/supabase');
const { sendTemplate, canSendToLead } = require('../_lib/whatsapp');
const { isHinglish, detectMarket } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    // Re-engage leads dropped 7-14 days ago (not older)
    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ ok: true, nudged: 0 });
    }

    let nudged = 0;

    for (const lead of droppedLeads) {
      const allowed = await canSendToLead(lead.phone);
      if (!allowed) continue;

      const market = detectMarket(lead.phone);
      const hinglish = isHinglish(market);

      await sendTemplate(lead.phone, 'nudge_trial', [lead.name || 'there']);
      nudged++;
    }

    // Also nudge active clients who haven't submitted check-in (24hr + 48hr nudge)
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let clientNudged = 0;

    for (const client of (activeClients || [])) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) continue;

      const { data: checkin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (checkin) continue;

      // Check when last message was sent (Sun = day 0, Mon = day 1, Tue = day 2)
      const dayOfWeek = new Date().getDay();
      if (dayOfWeek !== 1 && dayOfWeek !== 2) continue; // Only nudge Mon & Tue

      const allowed = await canSendToLead(client.phone);
      if (!allowed) continue;

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;
      const market = detectMarket(client.phone);
      const hinglish = isHinglish(market);

      await sendTemplate(client.phone, 'checkin_reminder', [
        client.name || 'there',
        String(currentWeek),
        checkinUrl
      ]);
      clientNudged++;
    }

    return res.status(200).json({ ok: true, leads_nudged: nudged, clients_nudged: clientNudged });
  } catch (err) {
    console.error('nudge-dropped cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
