const { supabase } = require('../../lib/supabase');
const { sendTemplate, canSendToLead } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    // Re-engage leads dropped 7-14 days ago (one-time nudge)
    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ message: 'No leads to nudge', nudged: 0 });
    }

    let nudged = 0;

    for (const lead of droppedLeads) {
      // Check if we already sent a re-engage nudge
      const { data: prevNudge } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 'reengage_dropped')
        .limit(1);

      if (prevNudge && prevNudge.length > 0) continue;

      const allowed = await canSendToLead(lead.phone);
      if (!allowed) continue;

      const hinglish = isHinglish(lead.market);
      const templateName = hinglish ? 'reengage_dropped_hi' : 'reengage_dropped';

      await sendTemplate(lead.phone, templateName, [
        lead.name || 'there'
      ]);

      nudged++;
    }

    // Also nudge active clients with pending check-ins (24hr / 48hr nudges)
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let checkinNudged = 0;

    if (activeClients) {
      for (const client of activeClients) {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSinceStart / 7);
        const dayOfWeek = now.getDay();

        // Only nudge Mon (24hr after Sun) and Tue (48hr after Sun)
        if (dayOfWeek !== 1 && dayOfWeek !== 2) continue;

        const { data: existingCheckin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .single();

        if (existingCheckin) continue;

        const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;
        const nudgeType = dayOfWeek === 1 ? '24hr' : '48hr';

        await sendTemplate(client.phone, 'checkin_reminder', [
          client.name || 'there',
          currentWeek.toString(),
          checkinUrl,
          nudgeType
        ], true);

        checkinNudged++;
      }
    }

    return res.status(200).json({
      message: `Nudged ${nudged} dropped leads, ${checkinNudged} check-in reminders`,
      nudged,
      checkinNudged
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
