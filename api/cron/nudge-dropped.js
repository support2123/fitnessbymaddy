const { supabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cronSecret = req.headers['x-vercel-cron'];
  const authHeader = req.headers.authorization;
  if (!cronSecret && authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    let actions = { nudged_leads: 0, nudged_checkins: 0, dropped: 0 };

    // FLOW A: Nudge new leads with no reply after 2 hours
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: staleLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('created_at', twentyFourHoursAgo);

    for (const lead of (staleLeads || [])) {
      const { data: msgs } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 'nudge_trial')
        .limit(1);

      if (msgs && msgs.length > 0) continue;

      await sendWhatsApp({
        phone: lead.phone,
        templateName: 'nudge_trial',
        params: [lead.name || 'there', 'https://www.fitnessbymaddy.com/intake']
      });
      actions.nudged_leads++;
    }

    // Drop leads older than 24 hours with no reply
    const { data: deadLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('last_msg_at', twentyFourHoursAgo);

    if (deadLeads && deadLeads.length > 0) {
      const ids = deadLeads.map(l => l.id);
      await supabase.from('leads').update({ status: 'dropped' }).in('id', ids);
      actions.dropped = ids.length;
    }

    // Re-engage dropped leads (7-day rule: only if dropped within last 7 days, try once)
    const { data: reengageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gt('created_at', sevenDaysAgo);

    for (const lead of (reengageLeads || [])) {
      const { data: msgs } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 'reengage_7day')
        .limit(1);

      if (msgs && msgs.length > 0) continue;

      await sendWhatsApp({
        phone: lead.phone,
        templateName: 'reengage_7day',
        params: [lead.name || 'there']
      });
    }

    // Nudge active clients who haven't submitted their weekly check-in
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    for (const client of (activeClients || [])) {
      const weeksElapsed = Math.ceil(
        (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
      );
      if (weeksElapsed < 1) continue;

      const { data: checkin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weeksElapsed)
        .limit(1);

      if (checkin && checkin.length > 0) continue;

      const { data: nudges } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', client.phone)
        .eq('template_name', 'checkin_nudge')
        .gte('sent_at', oneDayAgo)
        .limit(1);

      if (nudges && nudges.length > 0) continue;

      const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weeksElapsed}`;
      await sendWhatsApp({
        phone: client.phone,
        templateName: 'checkin_nudge',
        params: [client.name || 'there', checkinUrl]
      });
      actions.nudged_checkins++;
    }

    return res.json({ ok: true, actions });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
