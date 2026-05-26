const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const isAuthed = authHeader === `Bearer ${process.env.SUPABASE_SERVICE_KEY}`;

  if (!isVercelCron && !isAuthed) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ ok: true, message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    const errors = [];

    for (const client of activeClients) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

        if (weekNo < 1) continue;

        const { data: existingCheckin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .limit(1);

        if (existingCheckin && existingCheckin.length > 0) continue;

        const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

        await sendTemplate(client.phone, 'weekly_checkin', [
          client.name || 'there',
          `Week ${weekNo}`,
          checkinUrl
        ]);

        sent++;
      } catch (e) {
        errors.push({ client_id: client.id, error: e.message });
      }
    }

    const { data: missedClients } = await supabase
      .from('clients')
      .select('id, phone, name')
      .eq('status', 'active');

    if (missedClients) {
      for (const client of missedClients) {
        const { data: recentCheckins } = await supabase
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(3);

        if (recentCheckins && recentCheckins.length >= 2) {
          const weeks = recentCheckins.map(c => c.week_no).sort((a, b) => b - a);
          if (weeks.length >= 2 && weeks[0] - weeks[1] > 1) {
            const { notifyMaddy } = require('../lib/escalation');
            await notifyMaddy('2 consecutive missed check-ins', {
              phone: client.phone,
              clientName: client.name,
              message: `Last check-in: Week ${weeks[0]}. Missing weeks detected.`
            });
          }
        }
      }
    }

    return res.status(200).json({ ok: true, sent, errors: errors.length > 0 ? errors : undefined });
  } catch (error) {
    console.error('Weekly checkin cron error:', error.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
