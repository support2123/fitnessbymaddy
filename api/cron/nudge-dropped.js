const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, canSendMessage } = require('../../lib/whatsapp');
const { escalateToMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    // FLOW A step 3: Nudge leads with no reply after 2hrs
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Mark 24hr-old new leads as dropped
    await db.from('leads')
      .update({ status: 'dropped' })
      .eq('status', 'new')
      .lt('created_at', oneDayAgo);

    // Nudge new leads between 2-24hrs
    const { data: nudgeLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gte('created_at', oneDayAgo);

    let nudged = 0;
    for (const lead of (nudgeLeads || [])) {
      if (await canSendMessage(lead.phone)) {
        await sendTemplate(lead.phone, 'nudge_trial', [
          lead.name || 'there',
          'https://fitnessbymaddy.com/program-trial.html',
        ]);
        nudged++;
      }
    }

    // Re-engage dropped leads (7-day rule: only those dropped 5-7 days ago)
    const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const { data: reEngageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', fiveDaysAgo)
      .gte('last_msg_at', sevenDaysAgo);

    let reengaged = 0;
    for (const lead of (reEngageLeads || [])) {
      if (await canSendMessage(lead.phone)) {
        await sendTemplate(lead.phone, 'reengage_7day', [lead.name || 'there']);
        reengaged++;
      }
    }

    // Check for 2 consecutive missed check-ins → escalate
    const { data: activeClients } = await db
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    let escalated = 0;
    for (const client of (activeClients || [])) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 3) continue;

      const { data: recentCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .gte('week_no', currentWeek - 2)
        .order('week_no', { ascending: false });

      const submittedWeeks = (recentCheckins || []).map(c => c.week_no);
      if (!submittedWeeks.includes(currentWeek - 1) && !submittedWeeks.includes(currentWeek - 2)) {
        await escalateToMaddy('2 consecutive missed check-ins', {
          phone: client.phone,
          name: client.name,
          client_id: client.id,
        });
        escalated++;
      }
    }

    return res.json({ nudged, reengaged, escalated });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
