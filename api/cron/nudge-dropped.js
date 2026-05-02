const { getSupabase } = require('../lib/supabase');
const { sendTemplate, canSendToLead, notifyMaddy } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();
  const now = new Date();
  const results = { nudged_leads: 0, nudged_checkins: 0, escalated: 0, skipped: 0 };

  // --- Part 1: Nudge new leads who haven't replied ---
  const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
  const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: newLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .gte('created_at', sevenDaysAgo)
    .lte('created_at', twoHoursAgo);

  for (const lead of newLeads || []) {
    const leadAge = now - new Date(lead.created_at);
    const hoursSinceCreated = leadAge / (1000 * 60 * 60);

    if (hoursSinceCreated >= 24) {
      await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
      results.skipped++;
      continue;
    }

    const allowed = await canSendToLead(lead.phone);
    if (!allowed) {
      results.skipped++;
      continue;
    }

    try {
      await sendTemplate(lead.phone, 'nudge_trial', [
        lead.name || 'there',
        'https://fitnessbymaddy.com/program-trial.html'
      ]);
      results.nudged_leads++;
    } catch {
      results.skipped++;
    }
  }

  // --- Part 2: Nudge clients with pending check-ins ---
  const { data: activeClients } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active');

  for (const client of activeClients || []) {
    const startDate = new Date(client.program_started_at);
    const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
    const currentWeek = Math.floor(daysSinceStart / 7) + 1;

    const { data: checkin } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', currentWeek)
      .single();

    if (checkin) continue;

    const dayOfWeek = now.getDay();
    const daysSinceSunday = dayOfWeek === 0 ? 7 : dayOfWeek;

    if (daysSinceSunday >= 3) {
      const { data: prevMissed } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(1);

      const lastCheckedWeek = prevMissed?.[0]?.week_no || 0;
      const missedConsecutive = currentWeek - lastCheckedWeek - 1;

      if (missedConsecutive >= 2) {
        await db.from('escalations').insert({
          phone: client.phone,
          reason: `${missedConsecutive} consecutive missed check-ins`,
          message_body: `Client ${client.id}, current week ${currentWeek}`
        });
        await notifyMaddy('Missed Check-ins', `Client ${client.phone.slice(-4)} missed ${missedConsecutive} weeks`);
        results.escalated++;
        continue;
      }
    }

    if (daysSinceSunday === 1 || daysSinceSunday === 2) {
      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;
      try {
        await sendTemplate(client.phone, 'checkin_nudge', [
          client.name || 'there',
          `${currentWeek}`,
          checkinUrl
        ]);
        results.nudged_checkins++;
      } catch {
        results.skipped++;
      }
    }
  }

  res.status(200).json({ success: true, ...results });
};
