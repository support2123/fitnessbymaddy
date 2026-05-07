const supabase = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { isHinglishMarket } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !isVercelCron(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

    // New leads with no reply after 2 hours — send trial nudge
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: unrepliedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', twoDaysAgo);

    let nudgedNew = 0;
    for (const lead of (unrepliedLeads || [])) {
      const { data: existingNudge } = await supabase
        .from('nudges')
        .select('id')
        .eq('lead_id', lead.id)
        .eq('nudge_type', 'trial_nudge')
        .single();

      if (existingNudge) continue;

      const { data: replies } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gt('sent_at', lead.created_at)
        .limit(2);

      if (replies && replies.length > 1) continue;

      const market = lead.market || 'GLOBAL';
      const msg = isHinglishMarket(market)
        ? 'Still thinking? Try a $20 trial session with Maddy — zero risk, full experience!\n\nhttps://www.fitnessbymaddy.com/program-trial.html'
        : 'Still thinking? Try a $20 trial session with Maddy — zero risk, full experience!\n\nhttps://www.fitnessbymaddy.com/program-trial.html';

      await sendWhatsApp(lead.phone, msg, 'nudge_trial', true);
      await supabase.from('nudges').insert({ lead_id: lead.id, nudge_type: 'trial_nudge' });
      nudgedNew++;
    }

    // Leads with no reply after 24 hours — mark as dropped
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: staleLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', oneDayAgo);

    let dropped = 0;
    for (const lead of (staleLeads || [])) {
      const { data: replies } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gt('sent_at', lead.created_at)
        .limit(2);

      if (replies && replies.length > 1) continue;

      await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
      dropped++;
    }

    // Pending check-in nudges (+24hrs, +48hrs after Sunday send)
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*, leads(market)')
      .eq('status', 'active');

    let checkinNudged = 0;
    for (const client of (activeClients || [])) {
      const weekNo = calculateWeekNo(client.program_started_at);
      if (weekNo < 1) continue;

      const { data: checkin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (checkin) continue;

      const nudgeType = `checkin_nudge_w${weekNo}`;
      const { data: existingNudge } = await supabase
        .from('nudges')
        .select('id, sent_at')
        .eq('client_id', client.id)
        .eq('nudge_type', nudgeType);

      const nudgeCount = existingNudge?.length || 0;
      if (nudgeCount >= 2) continue;

      const market = client.leads?.market || 'GLOBAL';
      const msg = isHinglishMarket(market)
        ? `Reminder: Week ${weekNo} check-in abhi tak nahi aaya! Submit karo taaki hum plan update kar sakein.`
        : `Reminder: Your Week ${weekNo} check-in is still pending! Submit it so we can update your plan.`;

      await sendWhatsApp(client.phone, msg, null, true);
      await supabase.from('nudges').insert({ client_id: client.id, nudge_type: nudgeType });
      checkinNudged++;
    }

    return res.status(200).json({ ok: true, nudgedNew, dropped, checkinNudged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function calculateWeekNo(programStartedAt) {
  if (!programStartedAt) return 0;
  const start = new Date(programStartedAt);
  const now = new Date();
  return Math.ceil((now - start) / (7 * 24 * 60 * 60 * 1000));
}

function isVercelCron(req) {
  return req.headers['x-vercel-cron'] === '1';
}
