const { supabase } = require('../lib/supabase');
const { sendTemplate, sendText } = require('../lib/whatsapp');
const { detectMarket } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    let nudgedLeads = 0;
    let nudgedCheckins = 0;
    let dropped = 0;

    // --- LEAD NUDGES ---

    // 2-hour nudge: new leads with no reply
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString();

    const { data: staleNewLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo)
      .gte('created_at', fourHoursAgo);

    for (const lead of staleNewLeads || []) {
      // Check if we already nudged
      const { data: outMsgs } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'nudge_trial')
        .limit(1);

      if (!outMsgs || outMsgs.length === 0) {
        await sendTemplate(lead.phone, 'nudge_trial', [lead.name || 'there']);
        nudgedLeads++;
      }
    }

    // 24-hour drop: leads still status=new after 24hrs
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const { data: oldLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lte('created_at', oneDayAgo);

    for (const lead of oldLeads || []) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
      dropped++;
    }

    // 7-day re-engagement: dropped leads from exactly 7 days ago
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reEngageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lte('last_msg_at', sevenDaysAgo)
      .gte('last_msg_at', eightDaysAgo);

    for (const lead of reEngageLeads || []) {
      const market = detectMarket(lead.phone);
      if (market === 'IN') {
        await sendText(lead.phone,
          `Hey ${lead.name || 'there'}! Maddy's team se. ` +
          `Abhi bhi fitness goals pe kaam karna chahte ho? ` +
          `Humare $20 trial se start karo — koi commitment nahi 🙌\n\n` +
          `https://fitnessbymaddy.com/intake.html`
        );
      } else {
        await sendText(lead.phone,
          `Hey ${lead.name || 'there'}! Still thinking about your fitness goals? ` +
          `Start with our $20 trial — zero commitment 🙌\n\n` +
          `https://fitnessbymaddy.com/intake.html`
        );
      }
    }

    // --- CHECKIN NUDGES ---
    // Nudge active clients who haven't submitted after 24/48 hrs
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    const sunday = getMostRecentSunday();

    for (const client of activeClients || []) {
      const weekNo = Math.max(1, Math.ceil(
        (now.getTime() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
      ));

      const { data: checkin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (checkin && checkin.length > 0) continue;

      const hoursSinceSunday = (now.getTime() - sunday.getTime()) / (60 * 60 * 1000);

      if (hoursSinceSunday >= 24 && hoursSinceSunday < 30) {
        const market = detectMarket(client.phone);
        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
        if (market === 'IN') {
          await sendText(client.phone,
            `Reminder: Week ${weekNo} ka check-in abhi tak pending hai! ` +
            `2 minute lagenge bas:\n${checkinUrl}`
          );
        } else {
          await sendText(client.phone,
            `Reminder: Your Week ${weekNo} check-in is still pending! ` +
            `Takes just 2 minutes:\n${checkinUrl}`
          );
        }
        nudgedCheckins++;
      } else if (hoursSinceSunday >= 48 && hoursSinceSunday < 54) {
        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
        await sendText(client.phone,
          `Last reminder for Week ${weekNo} check-in! ` +
          `Without this, I can't update your plan:\n${checkinUrl}`
        );
        nudgedCheckins++;
      }
    }

    return res.status(200).json({
      nudgedLeads,
      nudgedCheckins,
      dropped,
      reEngaged: reEngageLeads?.length || 0
    });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function getMostRecentSunday() {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = day === 0 ? 0 : day;
  const sunday = new Date(now);
  sunday.setUTCDate(now.getUTCDate() - diff);
  sunday.setUTCHours(3, 30, 0, 0); // 9am IST = 3:30 UTC
  return sunday;
}
