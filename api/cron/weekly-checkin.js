const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');
const { escalateToMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*, leads!clients_lead_id_fkey(market)')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) continue;

      const { data: existingCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (existingCheckin) continue;

      // Check for 2 consecutive missed check-ins
      const { data: recentCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(1);

      const lastCheckinWeek = recentCheckins && recentCheckins[0] ? recentCheckins[0].week_no : 0;
      if (currentWeek - lastCheckinWeek >= 3) {
        await escalateToMaddy(
          '2+ consecutive missed check-ins',
          `Client: ${client.name || 'Unknown'} — last check-in was Week ${lastCheckinWeek}, now Week ${currentWeek}`
        );
        escalated++;
      }

      const market = client.leads ? client.leads.market : 'GLOBAL';
      const hinglish = isHinglish(market);
      const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;

      const templateName = hinglish ? 'weekly_checkin_hi' : 'weekly_checkin';
      await sendTemplate(client.phone, templateName, [
        client.name || 'there',
        currentWeek.toString(),
        checkinUrl
      ], true);

      sent++;
    }

    return res.status(200).json({
      message: `Weekly check-in sent to ${sent} clients, ${escalated} escalated`,
      sent,
      escalated
    });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
