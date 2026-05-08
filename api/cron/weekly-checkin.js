const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { programWeeks, detectMarket, isHinglish } = require('../../lib/helpers');
const { escalateToMaddy } = require('../../lib/escalate');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
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

    const results = [];

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);
      const totalWeeks = programWeeks(client.program);

      if (currentWeek > totalWeeks) {
        await db.from('clients').update({ status: 'completed' }).eq('id', client.id);
        await sendWhatsApp(client.phone, 'program_complete', [client.name || 'there']);
        results.push({ client_id: client.id, action: 'completed' });
        continue;
      }

      const { data: existingCheckin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (existingCheckin) {
        results.push({ client_id: client.id, action: 'already_submitted', week: currentWeek });
        continue;
      }

      const { data: missedCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const submittedWeeks = (missedCheckins || []).map(c => c.week_no);
      const lastTwoWeeks = [currentWeek - 1, currentWeek - 2];
      const consecutiveMisses = lastTwoWeeks.every(w => w > 0 && !submittedWeeks.includes(w));

      if (consecutiveMisses && currentWeek > 2) {
        await escalateToMaddy(
          '2 consecutive missed check-ins',
          client.phone,
          `Client ${client.name}, program ${client.program}, week ${currentWeek}`
        );
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;
      const market = detectMarket(client.phone);
      const template = isHinglish(market) ? 'weekly_checkin_hi' : 'weekly_checkin_en';

      await sendWhatsApp(client.phone, template, [
        client.name || 'there',
        String(currentWeek),
        checkinUrl,
      ]);

      results.push({ client_id: client.id, action: 'sent', week: currentWeek });
    }

    return res.status(200).json({ processed: results.length, results });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
