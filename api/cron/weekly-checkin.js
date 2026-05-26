const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { escalateToMaddy } = require('../_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ action: 'no_active_clients' });
    }

    const results = { sent: 0, nudged: 0, escalated: 0, skipped: 0 };

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.max(1, Math.ceil(daysSinceStart / 7));

      const { data: latestCheckin } = await db
        .from('checkins')
        .select('week_no, form_submitted_at')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestCheckin && latestCheckin.week_no >= currentWeek) {
        results.skipped++;
        continue;
      }

      const { count: missedCount } = await db
        .from('checkins')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', client.id)
        .gte('week_no', currentWeek - 2);

      const actualCheckins = missedCount || 0;
      const expectedCheckins = Math.min(2, currentWeek);
      const consecutiveMisses = expectedCheckins - actualCheckins;

      if (consecutiveMisses >= 2) {
        await escalateToMaddy({
          reason: '2 consecutive missed check-ins',
          phone: client.phone,
          clientName: client.name,
          message: `Client has missed ${consecutiveMisses} consecutive check-ins (current week: ${currentWeek})`
        });
        results.escalated++;
      }

      const checkinLink = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;
      const msg = `Hey ${client.name || 'there'}! It's check-in time (Week ${currentWeek}).\n\nFill this out so we can track your progress and adjust your plan:\n${checkinLink}\n\nTakes 2 minutes. Let's keep the momentum going!`;

      await sendWhatsApp({
        phone: client.phone,
        templateName: 'weekly_checkin',
        body: msg
      });
      results.sent++;
    }

    return res.status(200).json({ success: true, results });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
