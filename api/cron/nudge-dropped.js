const { getSupabase } = require('../../lib/supabase');
const { sendWhatsAppMessage } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !isVercelCron(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const results = { nudged: 0, skipped: 0, failed: 0 };

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('created_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ message: 'No leads to nudge', ...results });
    }

    for (const lead of droppedLeads) {
      try {
        const { data: recentMsg } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .gte('sent_at', sevenDaysAgo)
          .limit(1);

        if (recentMsg && recentMsg.length > 0) {
          results.skipped++;
          continue;
        }

        const market = lead.market || 'GLOBAL';
        const hinglish = isHinglish(market);

        const msg = hinglish
          ? `Hey ${lead.name || ''}! Maddy ki team se. Abhi bhi fitness goals pe kaam karna hai?\n\nHamara $20 trial class try karo — ek Zoom session mein decide karo ki yeh tumhare liye sahi hai ya nahi.\n\nInterested? "trial" reply karo!`
          : `Hey ${lead.name || ''}! It's Maddy's team. Still thinking about your fitness goals?\n\nTry our $20 trial class — one Zoom session to see if this is right for you.\n\nInterested? Reply "trial"!`;

        await sendWhatsAppMessage(lead.phone, msg, 'nudge_trial');

        await db.from('leads')
          .update({ last_msg_at: new Date().toISOString() })
          .eq('id', lead.id);

        results.nudged++;
      } catch (leadErr) {
        console.error(`Nudge failed for lead ${lead.id}:`, leadErr.message);
        results.failed++;
      }
    }

    await nudgePendingCheckins(db, results);

    return res.status(200).json({ success: true, ...results });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function nudgePendingCheckins(db, results) {
  const { data: activeClients } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active');

  if (!activeClients) return;

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const sunday = getLastSunday();

  for (const client of activeClients) {
    try {
      const weekNo = calculateWeekNo(client.program_started_at);
      if (weekNo < 1) continue;

      const { data: checkin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (checkin) continue;

      const { data: lastOut } = await db
        .from('messages')
        .select('sent_at')
        .eq('phone', client.phone)
        .eq('direction', 'out')
        .order('sent_at', { ascending: false })
        .limit(1)
        .single();

      if (!lastOut) continue;

      const lastSent = new Date(lastOut.sent_at);
      const hoursSinceLast = (Date.now() - lastSent.getTime()) / (1000 * 60 * 60);

      if (hoursSinceLast >= 24 && hoursSinceLast < 48) {
        const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
        const msg = `Reminder: Your Week ${weekNo} check-in is still pending! Takes just 2 minutes:\n${checkinUrl}`;
        await sendWhatsAppMessage(client.phone, msg);
      } else if (hoursSinceLast >= 48 && hoursSinceLast < 72) {
        const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
        const msg = `Last reminder for Week ${weekNo} check-in. Your progress tracking depends on it:\n${checkinUrl}`;
        await sendWhatsAppMessage(client.phone, msg);
      }
    } catch (e) {
      console.error(`Check-in nudge failed for ${client.id}:`, e.message);
    }
  }
}

function calculateWeekNo(startDate) {
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now - start;
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24 * 7));
}

function getLastSunday() {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? 0 : day;
  const sunday = new Date(now);
  sunday.setDate(now.getDate() - diff);
  sunday.setHours(0, 0, 0, 0);
  return sunday;
}

function isVercelCron(req) {
  return req.headers['x-vercel-cron'] === '1';
}
