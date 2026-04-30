const { supabase } = require('../_lib/supabase');
const { sendWhatsAppToClient } = require('../_lib/whatsapp');
const { escalateToMaddy } = require('../_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.json({ ok: true, message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    const errors = [];

    for (const client of activeClients) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.ceil(daysSinceStart / 7);

        if (weekNo < 1) continue;

        const { data: existing } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (existing) continue;

        const { data: missedCheckins } = await supabase
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(3);

        const submittedWeeks = (missedCheckins || []).map(c => c.week_no);
        const lastTwoWeeks = [weekNo - 1, weekNo - 2];
        const consecutiveMissed = lastTwoWeeks.every(w => w > 0 && !submittedWeeks.includes(w));

        if (consecutiveMissed && weekNo > 2) {
          await escalateToMaddy(
            client.phone,
            '2_consecutive_missed_checkins',
            `${client.name || 'Client'} has missed 2+ consecutive check-ins (current week: ${weekNo})`
          );
        }

        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
        const msg = `Hey ${client.name || 'there'}! Time for your Week ${weekNo} check-in. Fill this out so we can keep your progress on track:\n\n${checkinUrl}`;

        await sendWhatsAppToClient(client.phone, msg, 'weekly_checkin');
        sent++;
      } catch (clientErr) {
        errors.push({ client_id: client.id, error: clientErr.message });
      }
    }

    return res.json({ ok: true, sent, total: activeClients.length, errors });
  } catch (err) {
    console.error('Weekly checkin cron error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
