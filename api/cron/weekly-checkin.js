const { getSupabase } = require('../_lib/supabase');
const { sendClientMessage } = require('../_lib/whatsapp');
const { checkMissedCheckins } = require('../_lib/escalation');
const { isHinglishMarket } = require('../_lib/market');
const { detectMarket } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients, error } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (error) {
      console.error('Fetch clients error:', error.message);
      return res.status(500).json({ error: 'Failed to fetch clients' });
    }

    const results = { sent: 0, skipped: 0, escalated: 0 };

    for (const client of activeClients || []) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const msElapsed = now - startDate;
      const weekNo = Math.ceil(msElapsed / (7 * 24 * 60 * 60 * 1000));

      const maxWeeks = client.program === '12wk' ? 12 : 6;
      if (weekNo > maxWeeks) {
        results.skipped++;
        continue;
      }

      const { data: existing } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) {
        results.skipped++;
        continue;
      }

      const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const market = detectMarket(client.phone);
      const templateName = isHinglishMarket(market) ? 'weekly_checkin_hi' : 'weekly_checkin';

      await sendClientMessage(client.phone, templateName, [
        client.name || 'there',
        String(weekNo),
        checkinUrl
      ]);

      results.sent++;

      const escalated = await checkMissedCheckins(client.id);
      if (escalated) results.escalated++;
    }

    return res.status(200).json({
      ok: true,
      ...results,
      total: activeClients?.length || 0
    });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
