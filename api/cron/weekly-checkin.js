const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { escalateToMaddy } = require('../_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;

  if (!isVercelCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ ok: true, message: 'No active clients' });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const weekNo = calculateWeekNo(client.program_started_at);
      if (weekNo < 1) continue;

      const programWeeks = getProgramWeeks(client.program);
      if (weekNo > programWeeks) {
        await db.from('clients')
          .update({ status: 'completed' })
          .eq('id', client.id);
        continue;
      }

      const { data: existing } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1)
        .single();

      if (existing) continue;

      const { count: missedCount } = await db
        .from('checkins')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', client.id)
        .gte('week_no', weekNo - 2)
        .lt('week_no', weekNo);

      const expectedPrior = Math.min(weekNo - 1, 2);
      const actualMissed = expectedPrior - (missedCount || 0);

      if (actualMissed >= 2) {
        await escalateToMaddy(
          `2 consecutive missed check-ins`,
          client.name,
          client.phone
        );
        escalated++;
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

      await sendWhatsApp(client.phone, 'checkin_reminder', {
        link: checkinUrl,
        name: client.name || 'there',
        _isClient: true
      });

      sent++;
    }

    return res.status(200).json({
      ok: true,
      sent,
      escalated,
      total_active: activeClients.length
    });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function calculateWeekNo(startedAt) {
  if (!startedAt) return 0;
  const start = new Date(startedAt);
  const now = new Date();
  const diffMs = now - start;
  return Math.ceil(diffMs / (7 * 24 * 60 * 60 * 1000));
}

function getProgramWeeks(program) {
  const durations = {
    '6wk_gym': 6, '6wk_home': 6, '12wk': 12,
    'pcos': 8, '40plus': 8, 'zoom_trial': 1, 'zoom_pack': 4
  };
  return durations[program] || 6;
}
