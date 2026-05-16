const { supabase } = require('../lib/supabase');
const { sendTemplate, sendFreeform, detectMarket, notifyMaddy, maskPhone } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const results = { nudged_leads: 0, nudged_checkins: 0, escalated: 0 };

    await nudgeNewLeads(results);
    await nudgeMissedCheckins(results);

    return res.status(200).json(results);
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function nudgeNewLeads(results) {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: staleLeads } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('last_msg_at', twoHoursAgo)
    .gt('created_at', sevenDaysAgo);

  if (!staleLeads) return;

  for (const lead of staleLeads) {
    const lastMsg = new Date(lead.last_msg_at);
    const hoursSinceLastMsg = (Date.now() - lastMsg.getTime()) / (1000 * 60 * 60);

    if (hoursSinceLastMsg >= 24) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
      continue;
    }

    if (hoursSinceLastMsg >= 2 && hoursSinceLastMsg < 6) {
      const market = detectMarket(lead.phone);
      const isHinglish = market === 'IN';

      const message = isHinglish
        ? `Hey! 👋 Maddy ka $20 Zoom trial try karna chahoge? 30-min session mein full assessment + plan milega.\n\nhttps://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial\n\nKoi bhi question ho toh batao!`
        : `Hey! 👋 Want to try Maddy's $20 Zoom trial? Get a full 30-min assessment + personalized plan.\n\nhttps://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial\n\nAny questions? Just ask!`;

      await sendFreeform(lead.phone, message);
      results.nudged_leads++;
    }
  }
}

async function nudgeMissedCheckins(results) {
  const { data: activeClients } = await supabase
    .from('clients')
    .select('*')
    .eq('status', 'active');

  if (!activeClients) return;

  for (const client of activeClients) {
    const weekNo = calculateCurrentWeek(client.program_started_at);
    if (weekNo < 1) continue;

    const { data: checkin } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .single();

    if (checkin) continue;

    const { count: missedCount } = await supabase
      .from('checkins')
      .select('id', { count: 'exact' })
      .eq('client_id', client.id);

    const expectedCheckins = weekNo;
    const actualCheckins = missedCount || 0;
    const consecutiveMissed = expectedCheckins - actualCheckins;

    if (consecutiveMissed >= 2) {
      await notifyMaddy(
        '2 consecutive missed check-ins',
        `Client: ${client.name} (${maskPhone(client.phone)})\nProgram: ${client.program}\nMissed weeks: ${consecutiveMissed}`
      );
      results.escalated++;
      continue;
    }

    const daysSinceSunday = (new Date().getDay() + 7) % 7;
    if (daysSinceSunday >= 1 && daysSinceSunday <= 2) {
      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
      const market = detectMarket(client.phone);
      const msg = market === 'IN'
        ? `Reminder! 📝 Week ${weekNo} check-in abhi tak pending hai:\n${checkinUrl}\n\n2 min lagega — ye data plan adjust karne ke liye important hai!`
        : `Reminder! 📝 Your Week ${weekNo} check-in is still pending:\n${checkinUrl}\n\nTakes 2 min — this data helps me adjust your plan!`;

      await sendFreeform(client.phone, msg);
      results.nudged_checkins++;
    }
  }
}

function calculateCurrentWeek(startDate) {
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now - start;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.ceil(diffDays / 7);
}
