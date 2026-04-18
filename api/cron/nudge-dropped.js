const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = req.headers['authorization'];
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    // --- Part 1: Re-engage dropped leads (7-day rule) ---
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reengageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    const reengaged = [];
    for (const lead of (reengageLeads || [])) {
      const { data: recentOut } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .gte('sent_at', sevenDaysAgo)
        .limit(1);

      if (recentOut && recentOut.length > 0) continue;

      await sendWhatsApp(lead.phone, 'reengage_dropped', [
        lead.name || 'there',
      ]);
      reengaged.push(lead.id);
    }

    // --- Part 2: Nudge new leads with no reply (2hr mark) ---
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const { data: staleLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo)
      .gte('created_at', twentyFourHoursAgo);

    const nudged = [];
    for (const lead of (staleLeads || [])) {
      const { data: replies } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gte('sent_at', lead.created_at)
        .limit(2);

      if (replies && replies.length > 1) continue;

      const { data: nudgesSent } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 'nudge_trial')
        .limit(1);

      if (nudgesSent && nudgesSent.length > 0) continue;

      await sendWhatsApp(lead.phone, 'nudge_trial', [
        lead.name || 'there',
        'https://fitnessbymaddy.com/program-trial.html',
      ]);
      nudged.push(lead.id);
    }

    // --- Part 3: Mark 24hr-stale leads as dropped ---
    const { data: expiredLeads } = await db
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lte('created_at', twentyFourHoursAgo);

    const dropped = [];
    for (const lead of (expiredLeads || [])) {
      await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
      dropped.push(lead.id);
    }

    // --- Part 4: Escalate 2 consecutive missed check-ins ---
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    const escalated = [];
    for (const client of (activeClients || [])) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.floor(daysSinceStart / 7) + 1;

      if (currentWeek < 3) continue;

      const { data: lastCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(1);

      const lastWeek = lastCheckins?.[0]?.week_no || 0;
      if (currentWeek - lastWeek >= 2) {
        const maddyPhone = process.env.MADDY_PHONE;
        if (maddyPhone) {
          await sendWhatsApp(maddyPhone, 'escalation_alert', [
            client.phone.slice(-4),
            `2 consecutive missed check-ins (last: week ${lastWeek}, current: week ${currentWeek})`,
          ]);
        }
        escalated.push(client.id);
      }
    }

    return res.status(200).json({
      success: true,
      reengaged: reengaged.length,
      nudged: nudged.length,
      dropped: dropped.length,
      escalated: escalated.length,
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
