const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp, detectMarket } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cronSecret = req.headers['authorization'];
  if (process.env.CRON_SECRET && cronSecret !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    // --- Nudge new leads who haven't replied in 2 hours ---
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const { data: staleNewLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo)
      .gte('created_at', twentyFourHoursAgo);

    let nudged = 0;

    for (const lead of (staleNewLeads || [])) {
      const { count } = await db
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('template_name', 'nudge_trial');

      if ((count || 0) > 0) continue;

      const market = detectMarket(lead.phone);
      const trialUrl = 'https://fitnessbymaddy.com/program-trial.html';

      await sendWhatsApp(
        lead.phone,
        [lead.name || 'there', trialUrl],
        'nudge_trial'
      );
      nudged++;
    }

    // --- Mark 24hr+ non-responders as dropped ---
    const { data: expiredLeads } = await db
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lte('created_at', twentyFourHoursAgo);

    let dropped = 0;
    for (const lead of (expiredLeads || [])) {
      await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
      dropped++;
    }

    // --- Re-engage dropped leads (7-day rule) ---
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reengageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lte('last_msg_at', sevenDaysAgo)
      .gte('last_msg_at', eightDaysAgo);

    let reengaged = 0;

    for (const lead of (reengageLeads || [])) {
      const { count } = await db
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('template_name', 'reengage_7day');

      if ((count || 0) > 0) continue;

      const market = detectMarket(lead.phone);
      const msg = market === 'IN'
        ? 'Hey! Maddy ki team se dobara 👋 Abhi bhi fitness goals pe kaam karna hai? Hamare $20 trial session se start karein — koi commitment nahi!'
        : 'Hey! Maddy\'s team again 👋 Still thinking about your fitness goals? Start with our $20 trial session — no commitment!';

      await sendWhatsApp(lead.phone, [lead.name || 'there'], 'reengage_7day');
      reengaged++;
    }

    // --- Nudge clients who haven't submitted check-ins ---
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();

    const { data: pendingCheckins } = await db
      .from('checkins')
      .select('*, clients!inner(phone, name, status)')
      .is('form_submitted_at', null)
      .lte('created_at', oneDayAgo)
      .gte('created_at', twoDaysAgo);

    let checkinNudged = 0;

    for (const checkin of (pendingCheckins || [])) {
      if (checkin.clients.status !== 'active') continue;

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${checkin.client_id}&w=${checkin.week_no}`;
      await sendWhatsApp(
        checkin.clients.phone,
        [checkin.clients.name || 'there', String(checkin.week_no), checkinUrl],
        'checkin_nudge'
      );
      checkinNudged++;
    }

    return res.status(200).json({
      ok: true,
      nudged,
      dropped,
      reengaged,
      checkinNudged
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
