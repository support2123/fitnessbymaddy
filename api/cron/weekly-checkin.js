const { getSupabase } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');
const { detectMarket } = require('../_lib/market');
const { checkMissedCheckins } = require('../_lib/escalation');
const { maskPhone } = require('../_lib/pii');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'] || '';
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let errors = 0;

    for (const client of activeClients) {
      try {
        const weekNo = calculateWeekNo(client.program_started_at);
        if (weekNo < 1) continue;

        const maxWeeks = getMaxWeeks(client.program);
        if (weekNo > maxWeeks) continue;

        const { data: existing } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (existing) continue;

        await checkMissedCheckins(client.id);

        const { market } = detectMarket(client.phone);
        const lang = market === 'IN' ? 'hi' : 'en';
        const template = lang === 'hi' ? 'weekly_checkin_hi' : 'weekly_checkin';

        const formUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

        await sendTemplate(client.phone, template, [
          client.name || 'there',
          String(weekNo),
          formUrl,
        ]);

        sent++;
        console.log(`Check-in sent: ${maskPhone(client.phone)}, week ${weekNo}`);

      } catch (err) {
        errors++;
        console.error(`Error for client ${maskPhone(client.phone)}:`, err.message);
      }
    }

    return res.status(200).json({
      success: true,
      total_clients: activeClients.length,
      sent,
      errors,
    });

  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateWeekNo(startedAt) {
  const start = new Date(startedAt);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  return Math.ceil(diffDays / 7);
}

function getMaxWeeks(program) {
  const map = {
    '6wk_gym': 6, '6wk_home': 6, '12wk': 12,
    'pcos': 6, '40plus': 6, 'zoom_trial': 1, 'zoom_pack': 4,
  };
  return map[program] || 6;
}
