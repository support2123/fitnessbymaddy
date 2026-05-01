const { getSupabase } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');
const { detectMarket, isHinglish } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    // PART 1: Nudge new leads that haven't replied in 2 hours
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const { data: staleLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo);

    let nudged = 0;
    if (staleLeads) {
      for (const lead of staleLeads) {
        // Only nudge once (check if we already sent nudge_trial)
        const { data: existing } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .like('template_name', 'nudge_%')
          .limit(2);

        if (existing && existing.length >= 2) {
          // Already nudged twice — drop
          await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
          continue;
        }

        const market = detectMarket(lead.phone);
        const trialLink = 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial';
        const templateName = isHinglish(market) ? 'nudge_trial_hi' : 'nudge_trial';

        await sendTemplate(lead.phone, templateName, [
          lead.name || 'there',
          trialLink,
        ]);
        nudged++;
      }
    }

    // PART 2: Re-engage dropped leads after 7 days (one-time)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo)
      .gt('last_msg_at', fourteenDaysAgo);

    let reengaged = 0;
    if (droppedLeads) {
      for (const lead of droppedLeads) {
        // Check we haven't sent re-engagement
        const { data: existing } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'reengage_v1')
          .limit(1);

        if (existing && existing.length > 0) continue;

        const market = detectMarket(lead.phone);
        const templateName = isHinglish(market) ? 'reengage_v1_hi' : 'reengage_v1';

        await sendTemplate(lead.phone, templateName, [lead.name || 'there']);
        reengaged++;
      }
    }

    // PART 3: Nudge clients with pending check-ins (+24h, +48h)
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    const sunday = getMostRecentSunday(now);

    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let checkinNudged = 0;
    if (activeClients) {
      for (const client of activeClients) {
        const started = new Date(client.program_started_at);
        const weekNo = Math.ceil((now - started) / (7 * 24 * 60 * 60 * 1000));

        // Check if they submitted this week
        const { data: checkin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .limit(1);

        if (checkin && checkin.length > 0) continue;

        // Only nudge if it's been 24-48h since Sunday
        const hoursSinceSunday = (now - sunday) / (60 * 60 * 1000);
        if (hoursSinceSunday < 24 || hoursSinceSunday > 72) continue;

        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
        const market = detectMarket(client.phone);
        const templateName = isHinglish(market) ? 'checkin_nudge_hi' : 'checkin_nudge';

        await sendTemplate(client.phone, templateName, [
          client.name || 'there',
          checkinUrl,
        ]);
        checkinNudged++;
      }
    }

    return res.status(200).json({
      action: 'nudge_complete',
      nudged,
      reengaged,
      checkinNudged,
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function getMostRecentSunday(date) {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(3, 30, 0, 0); // 9am IST = 3:30 UTC
  return d;
}
