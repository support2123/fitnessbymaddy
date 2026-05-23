const { getSupabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers.authorization || '';
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const eightDaysAgo = new Date(Date.now() - 8 * 86400000).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', eightDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!droppedLeads?.length) {
      return res.json({ action: 'no_leads_to_nudge' });
    }

    const results = [];

    for (const lead of droppedLeads) {
      const { count } = await db
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('template_name', 'nudge_reactivate');

      if ((count || 0) > 0) {
        results.push({ phone: lead.phone, action: 'already_nudged' });
        continue;
      }

      await sendTemplate(lead.phone, 'nudge_reactivate', [
        lead.name || 'there'
      ]);

      results.push({ phone: lead.phone, action: 'nudged' });
    }

    const { data: pendingCheckins } = await db
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    for (const client of (pendingCheckins || [])) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((Date.now() - startDate) / 86400000);
      const currentWeek = Math.ceil(daysSinceStart / 7);

      const { data: checkin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .maybeSingle();

      if (checkin) continue;

      const { data: lastNudge } = await db
        .from('messages')
        .select('sent_at')
        .eq('phone', client.phone)
        .eq('template_name', 'checkin_nudge')
        .order('sent_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lastNudge) {
        const hoursSinceNudge = (Date.now() - new Date(lastNudge.sent_at)) / 3600000;
        if (hoursSinceNudge < 24) continue;
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;

      await sendTemplate(client.phone, 'checkin_nudge', [
        client.name || 'there',
        checkinUrl
      ]);
    }

    return res.json({ dropped_processed: results.length, results });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
