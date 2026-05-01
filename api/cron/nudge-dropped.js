const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reEngageLeads, error } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('last_msg_at', sevenDaysAgo)
      .gte('last_msg_at', fourteenDaysAgo);

    if (error) {
      console.error('[Cron:Nudge] DB error:', error.message);
      return res.status(500).json({ error: 'DB error' });
    }

    let nudged = 0;

    for (const lead of reEngageLeads || []) {
      const { data: recentOut } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'nudge_trial')
        .gte('sent_at', sevenDaysAgo)
        .limit(1);

      if (recentOut && recentOut.length > 0) continue;

      await sendWhatsApp({
        phone: lead.phone,
        templateName: 'nudge_trial',
        bodyValues: [
          lead.name || 'there',
          'https://fitnessbymaddy.com/program-trial.html',
        ],
      });

      nudged++;
      console.log(`[Cron:Nudge] Nudged ${maskPhone(lead.phone)}`);
    }

    const { data: pendingCheckins } = await db
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    let checkinNudges = 0;

    for (const client of pendingCheckins || []) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);
      if (currentWeek < 1) continue;

      const { data: checkin } = await db
        .from('checkins')
        .select('id, form_submitted_at')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (checkin) continue;

      const dayOfWeek = now.getDay();
      if (dayOfWeek === 1 || dayOfWeek === 2) {
        await sendWhatsApp({
          phone: client.phone,
          templateName: 'checkin_reminder',
          bodyValues: [
            client.name || 'there',
            String(currentWeek),
            `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`,
          ],
        });
        checkinNudges++;
      }
    }

    console.log(`[Cron:Nudge] Lead nudges: ${nudged}, Checkin reminders: ${checkinNudges}`);
    return res.status(200).json({ ok: true, lead_nudges: nudged, checkin_reminders: checkinNudges });
  } catch (err) {
    console.error('[Cron:Nudge] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
