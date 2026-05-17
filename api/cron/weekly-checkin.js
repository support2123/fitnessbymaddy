const { getSupabase } = require('../../lib/supabase');
const { sendText } = require('../../lib/whatsapp');
const { escalateToMaddy } = require('../../lib/escalation');
const { verifyCron } = require('../../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  if (!verifyCron(req)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.json({ ok: true, processed: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) continue;

      const { data: existing } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (existing) continue;

      const { data: missedCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const submittedWeeks = missedCheckins ? missedCheckins.map(c => c.week_no) : [];
      let consecutiveMissed = 0;
      for (let w = currentWeek - 1; w >= Math.max(1, currentWeek - 3); w--) {
        if (!submittedWeeks.includes(w)) {
          consecutiveMissed++;
        } else {
          break;
        }
      }

      if (consecutiveMissed >= 2) {
        await escalateToMaddy(
          '2 consecutive missed check-ins',
          client.phone,
          `${client.name || 'Client'} — ${client.program}, week ${currentWeek}`
        );
        escalated++;
      }

      const formUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;
      const msg = `Hey ${client.name || 'Champion'}! Time for your Week ${currentWeek} check-in.\n\nFill it here: ${formUrl}\n\nThis helps us fine-tune your next week's program.`;

      await sendText(client.phone, msg, true);
      sent++;
    }

    return res.json({ ok: true, processed: activeClients.length, sent, escalated });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
