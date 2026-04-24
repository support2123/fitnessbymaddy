const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cronSecret = req.headers['x-vercel-cron'];
  const authHeader = req.headers['authorization'];
  if (!cronSecret && authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    // Nudge new leads who haven't replied in 2 hours
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000);
    const { data: staleNewLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo.toISOString())
      .gt('created_at', new Date(now - 24 * 60 * 60 * 1000).toISOString());

    let nudged = 0;
    for (const lead of (staleNewLeads || [])) {
      const { data: msgs } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gt('sent_at', lead.created_at)
        .limit(1);

      if (!msgs || msgs.length === 0) {
        const { data: nudgeSent } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'nudge_trial')
          .limit(1);

        if (!nudgeSent || nudgeSent.length === 0) {
          await sendWhatsApp(lead.phone, 'nudge_trial', [
            lead.name || 'there',
            'https://www.fitnessbymaddy.com/program-trial.html',
          ]);
          nudged++;
        }
      }
    }

    // Drop leads with no reply after 24 hours
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
    const { data: expiredLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', oneDayAgo.toISOString());

    let dropped = 0;
    for (const lead of (expiredLeads || [])) {
      const { data: replies } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gt('sent_at', lead.created_at)
        .limit(1);

      if (!replies || replies.length === 0) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    // Re-engage dropped leads after 7 days (one-time)
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const eightDaysAgo = new Date(now - 8 * 24 * 60 * 60 * 1000);
    const { data: reengageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gt('last_msg_at', eightDaysAgo.toISOString())
      .lt('last_msg_at', sevenDaysAgo.toISOString());

    let reengaged = 0;
    for (const lead of (reengageLeads || [])) {
      const { data: reengage } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 'reengage_7day')
        .limit(1);

      if (!reengage || reengage.length === 0) {
        await sendWhatsApp(lead.phone, 'reengage_7day', [
          lead.name || 'there',
        ]);
        reengaged++;
      }
    }

    // Nudge active clients who haven't submitted check-in (24h and 48h after Sunday)
    const dayOfWeek = now.getDay();
    if (dayOfWeek === 1 || dayOfWeek === 2) {
      const { data: activeClients } = await db
        .from('clients')
        .select('*')
        .eq('status', 'active');

      for (const client of (activeClients || [])) {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSinceStart / 7);

        const { data: checkin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .single();

        if (!checkin) {
          const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;
          const nudgeTemplate = dayOfWeek === 1 ? 'checkin_nudge_24h' : 'checkin_nudge_48h';
          await sendWhatsApp(client.phone, nudgeTemplate, [
            client.name || 'there',
            checkinUrl,
          ]);
        }
      }
    }

    return res.status(200).json({
      success: true,
      nudged,
      dropped,
      reengaged,
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
