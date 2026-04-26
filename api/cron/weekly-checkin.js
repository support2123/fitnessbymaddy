const { supabase } = require('../../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../../lib/whatsapp');
const { maskPhone } = require('../../lib/market');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: activeClients, error } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (error) {
      console.error('Fetch clients error:', error.message);
      return res.status(500).json({ error: 'Failed to fetch clients' });
    }

    let sent = 0;
    let skipped = 0;
    const errors = [];

    for (const client of activeClients || []) {
      try {
        const weekNo = calculateWeekNumber(client.program_started_at);

        if (weekNo < 1) {
          skipped++;
          continue;
        }

        const maxWeeks = getMaxWeeks(client.program);
        if (weekNo > maxWeeks) {
          await supabase.from('clients')
            .update({ status: 'completed' })
            .eq('id', client.id);
          skipped++;
          continue;
        }

        const { data: existing } = await supabase
          .from('checkins')
          .select('id, form_submitted_at')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .maybeSingle();

        if (existing && existing.form_submitted_at) {
          skipped++;
          continue;
        }

        if (!existing) {
          await supabase.from('checkins').insert({
            client_id: client.id,
            week_no: weekNo
          });
        }

        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

        await sendTemplate(client.phone, 'weekly_checkin', [
          client.name || 'there',
          String(weekNo),
          checkinUrl
        ]);

        sent++;

        const { data: missedCheckins } = await supabase
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .is('form_submitted_at', null)
          .order('week_no', { ascending: false })
          .limit(3);

        if (missedCheckins && missedCheckins.length >= 2) {
          await notifyMaddy(
            '2+ missed check-ins',
            `Client: ${client.name || maskPhone(client.phone)}\nMissed weeks: ${missedCheckins.map(c => c.week_no).join(', ')}\nProgram: ${client.program}`
          );
        }

      } catch (clientErr) {
        errors.push({ client_id: client.id, error: clientErr.message });
      }
    }

    return res.status(200).json({
      success: true,
      total_clients: activeClients?.length || 0,
      sent,
      skipped,
      errors: errors.length
    });

  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};

function calculateWeekNumber(programStartedAt) {
  if (!programStartedAt) return 0;
  const start = new Date(programStartedAt);
  const now = new Date();
  const diffMs = now - start;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.ceil(diffDays / 7);
}

function getMaxWeeks(program) {
  const map = {
    '6wk_gym': 6, '6wk_home': 6,
    '12wk': 12,
    'pcos': 8, '40plus': 8,
    'zoom_trial': 1, 'zoom_pack': 4
  };
  return map[program] || 12;
}
