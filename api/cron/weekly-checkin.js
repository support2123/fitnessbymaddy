const { getSupabase } = require('../lib/supabase');
const { sendTemplate, maskPhone } = require('../lib/whatsapp');
const { notifyMaddy } = require('../lib/escalation');
const { logMessage } = require('../lib/rate-limit');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabase = getSupabase();

    const { data: activeClients } = await supabase
      .from('clients')
      .select('id, phone, name, program, program_started_at')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    const errors = [];

    for (const client of activeClients) {
      try {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor(
          (Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24)
        );
        const weekNo = Math.ceil(daysSinceStart / 7);

        if (weekNo < 1) continue;

        const { data: existing } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (existing) continue;

        const { data: lastTwo } = await supabase
          .from('checkins')
          .select('week_no, form_submitted_at')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(2);

        const missedCount = (lastTwo || []).filter(c => !c.form_submitted_at).length;
        if (missedCount >= 2) {
          await notifyMaddy(
            '2 missed check-ins',
            `${client.name || maskPhone(client.phone)} — ${missedCount} consecutive misses`
          );
        }

        await supabase.from('checkins').insert({
          client_id: client.id,
          week_no: weekNo,
          form_submitted_at: null,
        });

        const formUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

        await sendTemplate(client.phone, 'weekly_checkin', [
          client.name || 'there',
          String(weekNo),
          formUrl,
        ]);
        await logMessage(client.phone, 'out', `Week ${weekNo} check-in form sent`, 'weekly_checkin');

        sent++;
      } catch (clientErr) {
        errors.push({ clientId: client.id, error: clientErr.message });
        console.error(`Check-in send failed for ${maskPhone(client.phone)}:`, clientErr.message);
      }
    }

    return res.status(200).json({ sent, total: activeClients.length, errors: errors.length });
  } catch (err) {
    console.error('Weekly check-in cron error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
