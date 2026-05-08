const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { escalateToMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const { data: activeClients } = await db.from('clients')
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

      const { data: existing } = await db.from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (existing) {
        results.push({ client_id: client.id, action: 'already_submitted' });
        continue;
      }

      const { data: missedCheckins } = await db.from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const submittedWeeks = (missedCheckins || []).map(c => c.week_no);
      const lastTwoWeeks = [currentWeek - 1, currentWeek - 2];
      const consecutiveMisses = lastTwoWeeks.filter(w => w > 0 && !submittedWeeks.includes(w)).length;

      if (consecutiveMisses >= 2) {
        await escalateToMaddy(
          client.phone,
          client.name,
          'missed_checkins',
          `${client.name} has missed 2+ consecutive check-ins (Week ${currentWeek})`
        );
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;

      await sendWhatsApp(client.phone, 'weekly_checkin', {
        name: client.name,
        templateParams: [client.name, String(currentWeek)]
      }, `Hey ${client.name}! 📊\n\nTime for your Week ${currentWeek} check-in!\n\nPlease fill out your progress form:\n${checkinUrl}\n\nThis helps Maddy track your progress and adjust your program. 💪`);

      results.push({ client_id: client.id, week: currentWeek, action: 'sent' });
    }

    const nudgeQueue = results.filter(r => r.action === 'sent').map(r => ({
      client_id: r.client_id,
      week_no: r.week,
      nudge_at_24h: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      nudge_at_48h: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
    }));

    if (nudgeQueue.length > 0) {
      await db.from('nudge_queue').insert(nudgeQueue);
    }

    return res.status(200).json({ success: true, processed: results.length, results });

  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
