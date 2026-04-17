const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalate');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;

  if (!isCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    // Nudge new leads that haven't replied after 2 hours
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Drop leads with no response after 24 hours
    await db
      .from('leads')
      .update({ status: 'dropped' })
      .eq('status', 'new')
      .lt('created_at', oneDayAgo)
      .lt('last_msg_at', oneDayAgo);

    // Send trial nudge to leads created 2+ hrs ago with no qualification
    const { data: staleLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', oneDayAgo);

    let nudged = 0;
    if (staleLeads) {
      for (const lead of staleLeads) {
        const { count } = await db
          .from('messages')
          .select('*', { count: 'exact', head: true })
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'nudge_trial');

        if (count === 0) {
          const trialUrl = 'https://fitnessbymaddy.com/program-trial.html';
          await sendWhatsApp(lead.phone, 'nudge_trial', [
            lead.name || 'there',
            trialUrl,
          ]);
          nudged++;
        }
      }
    }

    // Check for clients with 2 consecutive missed check-ins
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let escalations = 0;
    if (activeClients) {
      for (const client of activeClients) {
        const weekNo = calculateWeekNo(client.program_started_at);
        if (weekNo < 3) continue;

        const { data: recentCheckins } = await db
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(2);

        const submittedWeeks = (recentCheckins || []).map(c => c.week_no);
        const missedLast = !submittedWeeks.includes(weekNo - 1);
        const missedPrev = !submittedWeeks.includes(weekNo - 2);

        if (missedLast && missedPrev) {
          await escalateToMaddy('2 consecutive missed check-ins', {
            phone: client.phone,
            client_id: client.id,
            name: client.name,
            missed_weeks: [weekNo - 2, weekNo - 1],
          });
          escalations++;
        }
      }
    }

    // Send check-in reminders (+24hrs, +48hrs nudges)
    let reminders = 0;
    if (activeClients) {
      for (const client of activeClients) {
        const weekNo = calculateWeekNo(client.program_started_at);
        if (weekNo < 1) continue;

        const { data: checkin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (!checkin) {
          const { data: sentNudges } = await db
            .from('messages')
            .select('*')
            .eq('phone', client.phone)
            .eq('direction', 'out')
            .ilike('template_name', 'checkin_reminder%')
            .gte('sent_at', sevenDaysAgo);

          const nudgeCount = sentNudges?.length || 0;
          if (nudgeCount < 2) {
            const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
            await sendWhatsApp(client.phone, 'checkin_reminder', [
              client.name || 'there',
              checkinUrl,
            ]);
            reminders++;
          }
        }
      }
    }

    return res.status(200).json({ ok: true, nudged, escalations, reminders });
  } catch (err) {
    console.error('[nudge-dropped] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function calculateWeekNo(startDate) {
  if (!startDate) return 0;
  const start = new Date(startDate);
  const now = new Date();
  return Math.ceil((now - start) / (1000 * 60 * 60 * 24 * 7));
}
