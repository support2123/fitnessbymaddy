const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { isHinglish, detectMarket } = require('../../lib/market');

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const results = { nudged_2hr: 0, nudged_24hr: 0, dropped: 0, re_engaged: 0 };

    // --- Flow A: 2-hour nudge for new leads with no reply ---
    await nudgeNewLeads(results);

    // --- Flow A: 24-hour drop for leads that never replied ---
    await dropStaleLeads(results);

    // --- Flow D: Nudge active clients who haven't submitted check-in ---
    await nudgePendingCheckins(results);

    // --- Re-engage dropped leads (7-day rule) ---
    await reEngageDroppedLeads(results);

    return res.status(200).json({ success: true, ...results });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function nudgeNewLeads(results) {
  const twoHoursAgo = new Date(Date.now() - TWO_HOURS_MS).toISOString();

  const { data: staleNewLeads } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('created_at', twoHoursAgo);

  for (const lead of staleNewLeads || []) {
    const { data: replies } = await supabase
      .from('messages')
      .select('id')
      .eq('phone', lead.phone)
      .eq('direction', 'in')
      .gt('sent_at', lead.created_at)
      .limit(1);

    if (replies && replies.length > 0) continue;

    const { data: nudges } = await supabase
      .from('messages')
      .select('id')
      .eq('phone', lead.phone)
      .eq('template_name', 'nudge_trial')
      .limit(1);

    if (nudges && nudges.length > 0) continue;

    const market = detectMarket(lead.phone);
    await sendTemplate(
      lead.phone,
      isHinglish(market) ? 'nudge_trial_hi' : 'nudge_trial_en',
      [lead.name || 'there'],
      true
    );
    results.nudged_2hr++;
  }
}

async function dropStaleLeads(results) {
  const twentyFourHoursAgo = new Date(Date.now() - TWENTY_FOUR_HOURS_MS).toISOString();

  const { data: staleLeads } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('created_at', twentyFourHoursAgo);

  for (const lead of staleLeads || []) {
    const { data: replies } = await supabase
      .from('messages')
      .select('id')
      .eq('phone', lead.phone)
      .eq('direction', 'in')
      .gt('sent_at', lead.created_at)
      .limit(1);

    if (replies && replies.length > 0) continue;

    await supabase
      .from('leads')
      .update({ status: 'dropped' })
      .eq('id', lead.id);

    results.dropped++;
  }
}

async function nudgePendingCheckins(results) {
  const { data: clients } = await supabase
    .from('clients')
    .select('*')
    .eq('status', 'active');

  const oneDayAgo = new Date(Date.now() - TWENTY_FOUR_HOURS_MS);
  const twoDaysAgo = new Date(Date.now() - 2 * TWENTY_FOUR_HOURS_MS);
  const sunday = getMostRecentSunday();

  for (const client of clients || []) {
    const weekNo = calculateWeekNo(client.program_started_at);
    if (weekNo < 1) continue;

    const { data: checkin } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .maybeSingle();

    if (checkin) continue;

    const hoursSinceSunday = (Date.now() - sunday.getTime()) / (1000 * 60 * 60);

    if (hoursSinceSunday >= 48) {
      const market = detectMarket(client.phone);
      await sendTemplate(
        client.phone,
        isHinglish(market) ? 'checkin_reminder_48h_hi' : 'checkin_reminder_48h_en',
        [client.name || 'there', String(weekNo)],
        true
      );
    } else if (hoursSinceSunday >= 24) {
      const market = detectMarket(client.phone);
      await sendTemplate(
        client.phone,
        isHinglish(market) ? 'checkin_reminder_24h_hi' : 'checkin_reminder_24h_en',
        [client.name || 'there', String(weekNo)],
        true
      );
    }
  }
}

async function reEngageDroppedLeads(results) {
  const sevenDaysAgo = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
  const fourteenDaysAgo = new Date(Date.now() - 2 * SEVEN_DAYS_MS).toISOString();

  const { data: droppedLeads } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'dropped')
    .gt('last_msg_at', fourteenDaysAgo)
    .lt('last_msg_at', sevenDaysAgo);

  for (const lead of droppedLeads || []) {
    const { data: reengaged } = await supabase
      .from('messages')
      .select('id')
      .eq('phone', lead.phone)
      .eq('template_name', 'reengage_dropped')
      .limit(1);

    if (reengaged && reengaged.length > 0) continue;

    const market = detectMarket(lead.phone);
    await sendTemplate(
      lead.phone,
      isHinglish(market) ? 'reengage_dropped_hi' : 'reengage_dropped_en',
      [lead.name || 'there'],
      true
    );
    results.re_engaged++;
  }
}

function calculateWeekNo(programStartedAt) {
  if (!programStartedAt) return 0;
  const start = new Date(programStartedAt);
  const now = new Date();
  return Math.ceil((now - start) / (7 * 24 * 60 * 60 * 1000));
}

function getMostRecentSunday() {
  const now = new Date();
  const day = now.getDay();
  const sunday = new Date(now);
  sunday.setDate(now.getDate() - day);
  sunday.setHours(3, 30, 0, 0); // 9:00 AM IST = 3:30 AM UTC
  return sunday;
}
