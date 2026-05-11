const { supabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { escalateToMaddy } = require('../_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !isVercelCron(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: clients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (!clients || clients.length === 0) {
      return res.status(200).json({ action: 'no_active_clients' });
    }

    const results = [];

    for (const client of clients) {
      const weekNo = calculateWeekNo(client.program_started_at);

      if (weekNo < 1) continue;

      const maxWeeks = getMaxWeeks(client.program);
      if (weekNo > maxWeeks) continue;

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .maybeSingle();

      if (existing) continue;

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

      await sendWhatsApp(client.phone, 'weekly_checkin', [
        client.name || 'there',
        String(weekNo),
        checkinUrl,
      ]);

      const consecutiveMissed = await checkConsecutiveMissed(client.id, weekNo);
      if (consecutiveMissed >= 2) {
        await escalateToMaddy('2 consecutive missed check-ins', {
          phone: client.phone,
          message: `Client ${client.name} has missed ${consecutiveMissed} check-ins in a row`,
        });
      }

      results.push({ client_id: client.id, week_no: weekNo, sent: true });
    }

    return res.status(200).json({ action: 'checkins_sent', count: results.length, results });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateWeekNo(programStartedAt) {
  const start = new Date(programStartedAt);
  const now = new Date();
  const diffMs = now - start;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.ceil(diffDays / 7);
}

function getMaxWeeks(program) {
  const map = { '6wk_gym': 6, '6wk_home': 6, '12wk': 12, 'pcos': 8, '40plus': 8, 'zoom_trial': 1, 'zoom_pack': 4 };
  return map[program] || 6;
}

async function checkConsecutiveMissed(clientId, currentWeek) {
  let missed = 0;
  for (let w = currentWeek - 1; w >= 1; w--) {
    const { data } = await supabase
      .from('checkins')
      .select('form_submitted_at')
      .eq('client_id', clientId)
      .eq('week_no', w)
      .maybeSingle();

    if (!data || !data.form_submitted_at) {
      missed++;
    } else {
      break;
    }
  }
  return missed;
}

function isVercelCron(req) {
  return req.headers['x-vercel-cron'] === '1';
}
