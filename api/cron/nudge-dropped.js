const { supabase } = require('../lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    await nudgeNewLeads();
    await nudgeMissedCheckins();
    await reEngageDroppedLeads();

    return res.status(200).json({ status: 'done' });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};

async function nudgeNewLeads() {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: staleLeads } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('last_msg_at', twoHoursAgo)
    .gt('last_msg_at', twentyFourHoursAgo);

  if (!staleLeads) return;

  for (const lead of staleLeads) {
    const { data: msgs } = await supabase
      .from('messages')
      .select('id')
      .eq('phone', lead.phone)
      .eq('direction', 'out')
      .eq('template_name', 'nudge_trial');

    if (msgs && msgs.length > 0) continue;

    const msg = lead.market === 'IN'
      ? "Hey! 👋 Abhi bhi soch rahe ho? Maddy ka $20 trial session try karo — ek session mein pata chal jaayega ki yeh tumhare liye hai ya nahi.\n\nhttps://fitnessbymaddy.com/program-trial.html"
      : "Hey! 👋 Still thinking? Try Maddy's $20 trial session — one session to see if this is right for you.\n\nhttps://fitnessbymaddy.com/program-trial.html";

    await sendWhatsApp({
      phone: lead.phone,
      templateName: 'nudge_trial',
      body: msg
    });
  }

  const { data: expiredLeads } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('last_msg_at', twentyFourHoursAgo);

  if (expiredLeads) {
    for (const lead of expiredLeads) {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('id', lead.id);
    }
  }
}

async function nudgeMissedCheckins() {
  const { data: activeClients } = await supabase
    .from('clients')
    .select('*')
    .eq('status', 'active');

  if (!activeClients) return;

  for (const client of activeClients) {
    const startDate = new Date(client.program_started_at);
    const now = new Date();
    const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

    const { data: checkin } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .limit(1);

    if (checkin && checkin.length > 0) continue;

    const daysSinceSunday = (now.getDay() + 7) % 7;
    if (daysSinceSunday >= 1 && daysSinceSunday <= 2) {
      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
      await sendWhatsApp({
        phone: client.phone,
        templateName: 'checkin_reminder',
        body: `Reminder: Your Week ${weekNo} check-in is still pending! 📝\n\n${checkinUrl}\n\nFill it out so we can keep your progress on track.`
      });
    }

    const { data: missedCheckins } = await supabase
      .from('checkins')
      .select('week_no')
      .eq('client_id', client.id)
      .order('week_no', { ascending: false })
      .limit(3);

    const completedWeeks = (missedCheckins || []).map(c => c.week_no);
    const lastTwoWeeks = [weekNo - 1, weekNo - 2].filter(w => w > 0);
    const consecutiveMisses = lastTwoWeeks.filter(w => !completedWeeks.includes(w)).length;

    if (consecutiveMisses >= 2) {
      await notifyMaddy(
        '2 consecutive missed check-ins',
        `Client: ${client.name} (${client.phone})\nProgram: ${client.program}\nMissed weeks: ${lastTwoWeeks.join(', ')}`
      );
    }
  }
}

async function reEngageDroppedLeads() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();

  const { data: reEngageLeads } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'dropped')
    .gt('last_msg_at', eightDaysAgo)
    .lt('last_msg_at', sevenDaysAgo);

  if (!reEngageLeads) return;

  for (const lead of reEngageLeads) {
    const { data: outMsgs } = await supabase
      .from('messages')
      .select('id')
      .eq('phone', lead.phone)
      .eq('direction', 'out')
      .eq('template_name', 'reengage_7day');

    if (outMsgs && outMsgs.length > 0) continue;

    const msg = lead.market === 'IN'
      ? "Hey! Maddy's team se ek last message 🙌\n\nAgar abhi bhi fitness goals pe kaam karna hai toh hum yahaan hain. Koi bhi sawaal ho — reply karo.\n\nNo pressure, sirf support 💛"
      : "Hey! One last message from Maddy's team 🙌\n\nIf you're still working on your fitness goals, we're here. Any questions — just reply.\n\nNo pressure, just support 💛";

    await sendWhatsApp({
      phone: lead.phone,
      templateName: 'reengage_7day',
      body: msg
    });
  }
}
