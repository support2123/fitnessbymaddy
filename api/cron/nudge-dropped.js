const { supabase } = require('../lib/supabase');
const { sendWhatsApp, detectMarket } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Nudge leads who went silent after 2 hours (Flow A step 3)
    await nudgeSilentLeads();

    // Drop leads with no reply after 24 hours (Flow A step 4)
    await dropStaleLeads();

    // Nudge clients who missed check-ins (+24h, +48h)
    await nudgeMissedCheckins();

    // Escalate clients with 2+ consecutive missed check-ins
    await escalateConsecutiveMisses();

    return res.status(200).json({ success: true, ran_at: new Date().toISOString() });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function nudgeSilentLeads() {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();

  const { data: silentLeads } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('created_at', twoHoursAgo)
    .gt('created_at', fourHoursAgo);

  if (!silentLeads) return;

  for (const lead of silentLeads) {
    const { data: msgs } = await supabase
      .from('messages')
      .select('id')
      .eq('phone', lead.phone)
      .eq('template_name', 'nudge_trial');

    if (msgs && msgs.length > 0) continue;

    const market = detectMarket(lead.phone);
    const message = market === 'IN'
      ? `Hey! 👋 Abhi bhi soch rahe ho? Maddy ka $20 trial session try karo — full guidance milegi!\n\nhttps://fitnessbymaddy.com/program-trial.html`
      : `Hey! 👋 Still thinking? Try Maddy's $20 trial session — full guidance included!\n\nhttps://fitnessbymaddy.com/program-trial.html`;

    await sendWhatsApp({
      phone: lead.phone,
      templateName: 'nudge_trial',
      body: message,
      params: [lead.name || 'there']
    });
  }
}

async function dropStaleLeads() {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  await supabase
    .from('leads')
    .update({ status: 'dropped' })
    .eq('status', 'new')
    .lt('created_at', twentyFourHoursAgo);
}

async function nudgeMissedCheckins() {
  const { data: activeClients } = await supabase
    .from('clients')
    .select('*')
    .eq('status', 'active');

  if (!activeClients) return;

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const sunday = getMostRecentSunday();

  for (const client of activeClients) {
    const weekNo = calculateWeekNo(client.program_started_at);

    const { data: checkin } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .single();

    if (checkin) continue;

    const hoursSinceSunday = (Date.now() - sunday.getTime()) / (1000 * 60 * 60);

    if (hoursSinceSunday >= 24 && hoursSinceSunday < 48) {
      await sendWhatsApp({
        phone: client.phone,
        body: `Reminder: Your Week ${weekNo} check-in is pending! Takes only 2 min 📊\nhttps://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`
      });
    } else if (hoursSinceSunday >= 48 && hoursSinceSunday < 72) {
      await sendWhatsApp({
        phone: client.phone,
        body: `Last reminder for Week ${weekNo} check-in! Submit today so we can prep your next program 🙏\nhttps://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`
      });
    }
  }
}

async function escalateConsecutiveMisses() {
  const { data: activeClients } = await supabase
    .from('clients')
    .select('*')
    .eq('status', 'active');

  if (!activeClients) return;

  for (const client of activeClients) {
    const weekNo = calculateWeekNo(client.program_started_at);
    if (weekNo < 3) continue;

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('week_no')
      .eq('client_id', client.id)
      .gte('week_no', weekNo - 2)
      .order('week_no', { ascending: false });

    const submittedWeeks = (recentCheckins || []).map(c => c.week_no);
    const missedConsecutive = !submittedWeeks.includes(weekNo - 1) && !submittedWeeks.includes(weekNo - 2);

    if (missedConsecutive) {
      await escalateToMaddy({
        reason: '2_consecutive_missed_checkins',
        phone: client.phone,
        message: `Client ${client.name || 'unknown'} missed weeks ${weekNo - 2} and ${weekNo - 1}`
      });
    }
  }
}

function calculateWeekNo(startDate) {
  const start = new Date(startDate);
  const now = new Date();
  return Math.max(1, Math.floor((now - start) / (7 * 24 * 60 * 60 * 1000)) + 1);
}

function getMostRecentSunday() {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? 0 : day;
  const sunday = new Date(now);
  sunday.setDate(now.getDate() - diff);
  sunday.setHours(3, 30, 0, 0); // 9am IST = 3:30 UTC
  return sunday;
}
