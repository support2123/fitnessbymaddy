const { supabase } = require('../../lib/supabase');
const { sendTemplate, sendTextMessage, canSendMessage } = require('../../lib/whatsapp');
const { getLanguage } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    let reengaged = 0;
    let checkinNudged = 0;

    // --- Re-engage dropped leads (7-day rule) ---
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('created_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    for (const lead of droppedLeads || []) {
      const allowed = await canSendMessage(lead.phone, false);
      if (!allowed) continue;

      const lang = getLanguage(lead.market);
      if (lang === 'hinglish') {
        await sendTemplate(lead.phone, 'reengage_v1', [
          'Hey! Maddy ke programs abhi bhi available hain. $20 Zoom trial se start karna chahoge? Limited slots hain! 💪',
        ]);
      } else {
        await sendTemplate(lead.phone, 'reengage_v1_en', [
          "Hey! Maddy's programs are still available. Want to start with the $20 Zoom trial? Limited slots! 💪",
        ]);
      }
      reengaged++;
    }

    // --- Nudge clients who missed check-ins ---
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const { data: activeClients } = await supabase
      .from('clients')
      .select('id, phone, name, program_started_at, leads(market)')
      .eq('status', 'active');

    for (const client of activeClients || []) {
      const weekNo = calculateWeekNo(client.program_started_at);
      if (weekNo < 1) continue;

      const { data: checkin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .maybeSingle();

      if (checkin) continue;

      const { data: lastMsg } = await supabase
        .from('messages')
        .select('sent_at')
        .eq('phone', client.phone)
        .eq('direction', 'out')
        .order('sent_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!lastMsg) continue;
      const lastSent = new Date(lastMsg.sent_at);
      const hoursSinceLastMsg = (Date.now() - lastSent.getTime()) / (60 * 60 * 1000);

      if (hoursSinceLastMsg < 24 || hoursSinceLastMsg > 72) continue;

      const market = client.leads?.market || 'GLOBAL';
      const lang = getLanguage(market);
      const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

      let nudgeMsg;
      if (hoursSinceLastMsg < 48) {
        nudgeMsg = lang === 'hinglish'
          ? `Reminder! 📋 Week ${weekNo} check-in abhi tak pending hai. Yahan submit karo: ${checkinUrl}`
          : `Reminder! 📋 Your Week ${weekNo} check-in is still pending. Submit here: ${checkinUrl}`;
      } else {
        nudgeMsg = lang === 'hinglish'
          ? `Last reminder! 📋 Week ${weekNo} check-in miss mat karo — program adjust karna hai aapke liye: ${checkinUrl}`
          : `Last reminder! 📋 Don't miss your Week ${weekNo} check-in — we need to adjust your program: ${checkinUrl}`;
      }

      await sendTextMessage(client.phone, nudgeMsg);
      checkinNudged++;
    }

    // --- Nudge new leads (2hr + 24hr follow-up) ---
    let leadNudged = 0;
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo);

    for (const lead of newLeads || []) {
      const allowed = await canSendMessage(lead.phone, false);
      if (!allowed) continue;

      const hoursSinceCreated = (Date.now() - new Date(lead.created_at).getTime()) / (60 * 60 * 1000);

      if (hoursSinceCreated >= 24) {
        await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        continue;
      }

      if (hoursSinceCreated >= 2 && hoursSinceCreated < 24) {
        const lang = getLanguage(lead.market);
        if (lang === 'hinglish') {
          await sendTemplate(lead.phone, 'nudge_trial', [
            'Abhi decide nahi hua? $20 Zoom trial try karo — Maddy ke saath live session! 💪\nhttps://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
          ]);
        } else {
          await sendTemplate(lead.phone, 'nudge_trial_en', [
            "Still deciding? Try the $20 Zoom trial — a live session with Maddy! 💪\nhttps://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial",
          ]);
        }
        leadNudged++;
      }
    }

    return res.status(200).json({
      ok: true,
      reengaged,
      checkin_nudged: checkinNudged,
      lead_nudged: leadNudged,
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function calculateWeekNo(programStartedAt) {
  if (!programStartedAt) return 0;
  const start = new Date(programStartedAt);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  return Math.floor(diffDays / 7) + 1;
}
