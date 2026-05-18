const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { isHinglish } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    // Flow A: nudge leads who haven't replied in 2 hours (status=new)
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const { data: staleNewLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo)
      .gte('created_at', twentyFourHoursAgo);

    let nudged = 0;
    let dropped = 0;

    for (const lead of (staleNewLeads || [])) {
      const { count } = await db
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .gt('sent_at', lead.created_at)
        .limit(2);

      if ((count || 0) >= 2) continue;

      await sendTemplate(lead.phone, 'nudge_trial', [
        lead.name || 'there',
        'https://www.fitnessbymaddy.com/shred.html'
      ]);
      nudged++;
    }

    // Drop leads with no reply after 24 hours
    const { data: expiredLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twentyFourHoursAgo);

    for (const lead of (expiredLeads || [])) {
      const { count } = await db
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gt('sent_at', lead.created_at);

      if ((count || 0) > 1) continue;

      await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
      dropped++;
    }

    // Re-engage dropped leads (7-day rule)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reEngageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lte('created_at', sevenDaysAgo)
      .gte('created_at', eightDaysAgo);

    let reEngaged = 0;

    for (const lead of (reEngageLeads || [])) {
      const { count } = await db
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .gte('sent_at', sevenDaysAgo);

      if ((count || 0) > 0) continue;

      await sendTemplate(lead.phone, 'reengage_7day', [
        lead.name || 'there'
      ]);
      reEngaged++;
    }

    // Nudge active clients with pending check-ins (+24h, +48h)
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let clientNudges = 0;

    for (const client of (activeClients || [])) {
      const weeksActive = Math.ceil(
        (now.getTime() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
      );

      const { data: checkin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weeksActive)
        .single();

      if (checkin) continue;

      const sundayMidnight = getMostRecentSunday();
      const hoursSinceSunday = (now.getTime() - sundayMidnight.getTime()) / (60 * 60 * 1000);

      if (hoursSinceSunday >= 24 && hoursSinceSunday < 30) {
        const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weeksActive}`;
        await sendTemplate(client.phone, 'checkin_reminder', [
          client.name || 'there',
          checkinUrl
        ]);
        clientNudges++;
      } else if (hoursSinceSunday >= 48 && hoursSinceSunday < 54) {
        const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weeksActive}`;
        await sendTemplate(client.phone, 'checkin_final_reminder', [
          client.name || 'there',
          checkinUrl
        ]);
        clientNudges++;
      }
    }

    return res.status(200).json({
      ok: true,
      nudged,
      dropped,
      re_engaged: reEngaged,
      client_nudges: clientNudges
    });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function getMostRecentSunday() {
  const now = new Date();
  const dayOfWeek = now.getUTCDay();
  const sunday = new Date(now);
  sunday.setUTCDate(now.getUTCDate() - dayOfWeek);
  sunday.setUTCHours(3, 30, 0, 0); // 9am IST = 3:30 UTC
  return sunday;
}
