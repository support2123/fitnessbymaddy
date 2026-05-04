const { getSupabase } = require('../lib/supabase');
const { sendTemplate, canSendToLead } = require('../lib/whatsapp');
const { isHinglish, detectMarket } = require('../lib/market');
const { escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('id, phone, name, program, program_started_at')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.json({ action: 'no_active_clients' });
    }

    const results = { sent: 0, skipped: 0, escalated: 0 };

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) {
        results.skipped++;
        continue;
      }

      const { data: existing } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (existing && existing.length > 0) {
        results.skipped++;
        continue;
      }

      const { data: missedCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const lastCheckinWeek = missedCheckins?.[0]?.week_no || 0;
      const missedConsecutive = weekNo - lastCheckinWeek - 1;

      if (missedConsecutive >= 2) {
        await escalateToMaddy('2 consecutive missed check-ins', {
          phone: client.phone,
          details: `${client.name || 'Client'} missed weeks ${lastCheckinWeek + 1}-${weekNo - 1}`,
        });
        results.escalated++;
      }

      const market = detectMarket(client.phone);
      const hinglish = isHinglish(market);
      const formUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

      await sendTemplate(client.phone, hinglish ? 'weekly_checkin_hi' : 'weekly_checkin', [
        client.name || 'there',
        String(weekNo),
        formUrl,
      ]);

      results.sent++;
    }

    return res.json({ success: true, ...results });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
