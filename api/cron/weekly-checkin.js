const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { escalateToMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  const cronSecret = req.headers['x-vercel-cron'];
  if (!cronSecret && (!authHeader || authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`)) {
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

      if (currentWeek < 1) continue;

      const { data: existingCheckin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .limit(1);

      if (existingCheckin && existingCheckin.length > 0) continue;

      const { data: missedWeeks } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const submittedWeeks = (missedWeeks || []).map(c => c.week_no);
      const lastTwoWeeks = [currentWeek - 1, currentWeek - 2];
      const consecutiveMisses = lastTwoWeeks.filter(w => w > 0 && !submittedWeeks.includes(w)).length;

      if (consecutiveMisses >= 2) {
        await escalateToMaddy(
          '2 consecutive missed check-ins',
          `Client: ${client.name || 'Unknown'} (${client.phone.slice(0, 3)}XXX...${client.phone.slice(-3)})\nMissed weeks: ${lastTwoWeeks.filter(w => !submittedWeeks.includes(w)).join(', ')}`
        );
      }

      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://www.fitnessbymaddy.com';

      const checkinUrl = `${baseUrl}/checkin?c=${client.id}&w=${currentWeek}`;

      await sendWhatsApp({
        phone: client.phone,
        templateName: 'weekly_checkin',
        params: [client.name || 'there', String(currentWeek), checkinUrl],
        body: `Hey ${client.name || 'there'}! Time for your Week ${currentWeek} check-in.\n\nFill it out here: ${checkinUrl}\n\nTrack your progress, upload photos, and let us know how the week went!`,
      });

      results.push({ client_id: client.id, week: currentWeek });
    }

    return res.status(200).json({ action: 'checkins_sent', count: results.length, results });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
