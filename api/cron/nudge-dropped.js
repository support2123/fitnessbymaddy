const supabase = require('../../lib/supabase');
const { sendTemplate, sendText } = require('../../lib/whatsapp');
const { isHinglish, detectMarket } = require('../../lib/market');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();

    // --- Nudge new leads who haven't replied in 2 hours ---
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const { data: staleNewLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('last_msg_at', twentyFourHoursAgo);

    let nudged = 0;
    if (staleNewLeads) {
      for (const lead of staleNewLeads) {
        const { count } = await supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .gt('sent_at', lead.created_at)
          .neq('template_name', 'welcome_v1_hi')
          .neq('template_name', 'welcome_v1_en');

        if ((count || 0) > 0) continue;

        const market = detectMarket(lead.phone);
        if (isHinglish(market)) {
          await sendTemplate(lead.phone, 'nudge_trial_hi', [lead.name || 'there']);
        } else {
          await sendTemplate(lead.phone, 'nudge_trial_en', [lead.name || 'there']);
        }
        nudged++;
      }
    }

    // --- Drop leads who haven't replied in 24 hours ---
    const { data: deadLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('last_msg_at', twentyFourHoursAgo);

    let dropped = 0;
    if (deadLeads && deadLeads.length > 0) {
      const ids = deadLeads.map(l => l.id);
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .in('id', ids);
      dropped = ids.length;
    }

    // --- Nudge check-in reminders (+24h, +48h) ---
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let checkinNudges = 0;
    if (activeClients) {
      for (const client of activeClients) {
        const weekNo = calculateWeekNo(client.program_started_at);
        if (weekNo < 1) continue;

        const { data: checkin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (checkin) continue;

        const daysSinceSunday = getDaysSinceLastSunday();
        if (daysSinceSunday !== 1 && daysSinceSunday !== 2) continue;

        const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
        const market = detectMarket(client.phone);

        if (isHinglish(market)) {
          await sendText(client.phone,
            `Hey ${client.name || ''}! 🔔 Week ${weekNo} ka check-in abhi tak pending hai.\n\n` +
            `📋 ${checkinUrl}\n\n` +
            `2 min lagenge — Maddy ko tera progress dekhna hai! 💪`
          );
        } else {
          await sendText(client.phone,
            `Hey ${client.name || ''}! 🔔 Your Week ${weekNo} check-in is still pending.\n\n` +
            `📋 ${checkinUrl}\n\n` +
            `Takes just 2 minutes — Maddy wants to see your progress! 💪`
          );
        }
        checkinNudges++;
      }
    }

    // --- Re-engage dropped leads (7-day rule) ---
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reengageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo)
      .gt('last_msg_at', eightDaysAgo);

    let reengaged = 0;
    if (reengageLeads) {
      for (const lead of reengageLeads) {
        const market = detectMarket(lead.phone);
        if (isHinglish(market)) {
          await sendTemplate(lead.phone, 'reengage_hi', [lead.name || 'there']);
        } else {
          await sendTemplate(lead.phone, 'reengage_en', [lead.name || 'there']);
        }
        await supabase
          .from('leads')
          .update({ status: 'new', last_msg_at: now.toISOString() })
          .eq('id', lead.id);
        reengaged++;
      }
    }

    return res.status(200).json({
      status: 'done',
      nudged,
      dropped,
      checkin_nudges: checkinNudges,
      reengaged
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

function calculateWeekNo(programStartedAt) {
  const start = new Date(programStartedAt);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  return Math.ceil(Math.floor(diffMs / (1000 * 60 * 60 * 24)) / 7);
}

function getDaysSinceLastSunday() {
  const now = new Date();
  return now.getDay();
}
