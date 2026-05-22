const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'] || '';
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;

  if (!isVercelCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeadsToNudge } = await db
      .from('leads')
      .select('id, phone, name')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo)
      .gte('created_at', twentyFourHoursAgo);

    let nudged = 0;

    if (newLeadsToNudge) {
      for (const lead of newLeadsToNudge) {
        const { data: msgs } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'nudge_trial')
          .limit(1);

        if (msgs && msgs.length > 0) continue;

        await sendWhatsApp(lead.phone, 'nudge_trial', [
          lead.name || 'there',
          'https://www.fitnessbymaddy.com/program-trial.html',
        ]);

        nudged++;
      }
    }

    const { data: staleLeads } = await db
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lte('created_at', twentyFourHoursAgo);

    let dropped = 0;

    if (staleLeads) {
      for (const lead of staleLeads) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    const { data: droppedLeads } = await db
      .from('leads')
      .select('id, phone, name, program_interest')
      .eq('status', 'dropped')
      .gte('created_at', sevenDaysAgo);

    let reengaged = 0;

    if (droppedLeads) {
      for (const lead of droppedLeads) {
        const { data: msgs } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'reengage_7day')
          .limit(1);

        if (msgs && msgs.length > 0) continue;

        await sendWhatsApp(lead.phone, 'reengage_7day', [
          lead.name || 'there',
        ]);

        reengaged++;
      }
    }

    const { data: pendingCheckins } = await db
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    let checkinNudges = 0;

    if (pendingCheckins) {
      for (const client of pendingCheckins) {
        const startDate = new Date(client.program_started_at);
        const currentWeek = Math.ceil((Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 7));

        const { data: checkin } = await db
          .from('checkins')
          .select('id, form_submitted_at')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .limit(1);

        if (checkin && checkin.length > 0) continue;

        const { data: nudgeMsgs } = await db
          .from('messages')
          .select('id, sent_at')
          .eq('phone', client.phone)
          .eq('template_name', 'checkin_nudge')
          .order('sent_at', { ascending: false })
          .limit(1);

        const lastNudge = nudgeMsgs?.[0]?.sent_at;
        if (lastNudge) {
          const hoursSinceNudge = (Date.now() - new Date(lastNudge).getTime()) / (1000 * 60 * 60);
          if (hoursSinceNudge < 24) continue;
        }

        const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;

        await sendWhatsApp(client.phone, 'checkin_nudge', [
          client.name || 'there',
          checkinUrl,
        ]);

        checkinNudges++;
      }
    }

    return res.status(200).json({
      ok: true,
      nudged,
      dropped,
      reengaged,
      checkin_nudges: checkinNudges,
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
