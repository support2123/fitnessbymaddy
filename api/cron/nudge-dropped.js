const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { isHinglishMarket } = require('../../lib/market');

// Runs daily — re-engages leads that went silent
// Also sends nudge reminders at 2hr and 24hr marks for new leads
module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    const results = { nudge_2hr: 0, nudge_24hr: 0, dropped: 0, reengaged: 0 };

    // --- 2-hour nudge for new leads with no reply ---
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const threeHoursAgo = new Date(now - 3 * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', threeHoursAgo);

    for (const lead of newLeads || []) {
      // Check if we already sent a nudge (more than 1 outbound message)
      const { count } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('direction', 'out');

      if (count <= 1) {
        const hinglish = isHinglishMarket(lead.market);
        const template = hinglish ? 'nudge_trial' : 'nudge_trial_en';
        await sendTemplate(lead.phone, template, [lead.name || 'there']);
        results.nudge_2hr++;
      }
    }

    // --- 24-hour drop for leads still at 'new' status ---
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const twoDaysAgo = new Date(now - 48 * 60 * 60 * 1000).toISOString();

    const { data: staleLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('created_at', oneDayAgo)
      .gt('created_at', twoDaysAgo);

    for (const lead of staleLeads || []) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
      results.dropped++;
    }

    // --- 7-day re-engagement for dropped leads ---
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reengageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo)
      .gt('last_msg_at', eightDaysAgo);

    for (const lead of reengageLeads || []) {
      const hinglish = isHinglishMarket(lead.market);
      const template = hinglish ? 'reengage_7day' : 'reengage_7day_en';
      await sendTemplate(lead.phone, template, [lead.name || 'there']);
      results.reengaged++;
    }

    // --- Nudge active clients who haven't submitted check-in (+24hr, +48hr) ---
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let checkinNudges = 0;
    for (const client of activeClients || []) {
      const startDate = new Date(client.program_started_at);
      const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

      const { data: checkin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (!checkin) {
        // Check when last check-in reminder was sent (from messages table)
        const { data: lastNudge } = await supabase
          .from('messages')
          .select('sent_at')
          .eq('phone', client.phone)
          .eq('template_name', 'checkin_nudge')
          .order('sent_at', { ascending: false })
          .limit(1);

        const lastNudgeTime = lastNudge?.[0]?.sent_at;
        const hoursSinceNudge = lastNudgeTime
          ? (now - new Date(lastNudgeTime)) / (60 * 60 * 1000)
          : 999;

        if (hoursSinceNudge >= 24) {
          const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
          await sendTemplate(client.phone, 'checkin_nudge', [
            client.name || 'there', String(weekNo), checkinUrl
          ]);
          checkinNudges++;
        }
      }
    }

    results.checkin_nudges = checkinNudges;
    return res.status(200).json({ ok: true, ...results });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron job failed' });
  }
};
