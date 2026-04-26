const { supabase } = require('../../lib/supabase');
const { sendTemplate, canSendToLead } = require('../../lib/whatsapp');
const { isHinglishMarket } = require('../../lib/market');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).end();

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

    const { data: nudgeLeads } = await supabase
      .from('leads')
      .select('id, phone, name, market, program_interest, last_msg_at')
      .eq('status', 'new')
      .gte('created_at', sevenDaysAgo)
      .lte('last_msg_at', twoDaysAgo);

    let nudged = 0;

    for (const lead of nudgeLeads || []) {
      const canSend = await canSendToLead(lead.phone);
      if (!canSend) continue;

      if (isHinglishMarket(lead.market)) {
        await sendTemplate(lead.phone, 'nudge_trial', [lead.name || 'there']);
      } else {
        await sendTemplate(lead.phone, 'nudge_trial_en', [lead.name || 'there']);
      }
      nudged++;
    }

    const { data: checkinNudges } = await supabase
      .from('clients')
      .select('id, phone, name, program_started_at, lead:leads(market)')
      .eq('status', 'active');

    let checkinNudged = 0;

    for (const client of checkinNudges || []) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      const weekNo = Math.floor(daysSinceStart / 7) + 1;
      const dayInWeek = daysSinceStart % 7;

      if (dayInWeek !== 1 && dayInWeek !== 2) continue;

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .maybeSingle();

      if (existing) continue;

      const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const market = client.lead?.market || 'GLOBAL';

      await sendTemplate(client.phone, 'checkin_reminder', [
        client.name || 'there',
        String(weekNo),
        checkinUrl,
      ]);
      checkinNudged++;
    }

    return res.status(200).json({ ok: true, leads_nudged: nudged, checkin_nudged: checkinNudged });
  } catch (err) {
    console.error('[Cron Nudge Error]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
