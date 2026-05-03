const { getSupabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { detectMarket, isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('id, phone, name, market, last_msg_at')
      .eq('status', 'dropped')
      .gte('last_msg_at', thirtyDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.json({ ok: true, message: 'No leads to re-engage', sent: 0 });
    }

    let sent = 0;

    for (const lead of droppedLeads) {
      const { data: recentMsg } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .gte('sent_at', sevenDaysAgo)
        .limit(1)
        .single();

      if (recentMsg) continue;

      await sendTemplate(lead.phone, 'win_back', [lead.name || 'there']);
      sent++;
    }

    const { data: pendingCheckins } = await db
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    let nudged = 0;

    if (pendingCheckins) {
      for (const client of pendingCheckins) {
        const weekNo = Math.floor(
          (Date.now() - new Date(client.program_started_at).getTime()) /
          (7 * 24 * 60 * 60 * 1000)
        ) + 1;

        const { data: checkin } = await db
          .from('checkins')
          .select('id, form_submitted_at')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .limit(1)
          .single();

        if (checkin) continue;

        const lastSunday = getLastSunday();
        const hoursSinceSunday = (Date.now() - lastSunday.getTime()) / (1000 * 60 * 60);

        if (hoursSinceSunday >= 24 && hoursSinceSunday < 72) {
          const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
          await sendTemplate(client.phone, 'checkin_reminder', [
            client.name || 'there',
            checkinUrl,
          ]);
          nudged++;
        }
      }
    }

    return res.json({ ok: true, reengaged: sent, checkin_nudged: nudged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function getLastSunday() {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? 0 : day;
  const sunday = new Date(now);
  sunday.setDate(now.getDate() - diff);
  sunday.setHours(3, 30, 0, 0); // 9am IST = 3:30 UTC
  return sunday;
}
