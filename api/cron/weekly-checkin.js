const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { generateToken, cors } = require('../lib/helpers');
const { escalateToMaddy } = require('../lib/escalate');

module.exports = async function handler(req, res) {
  cors(res);

  const authHeader = req.headers['authorization'] || '';
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isVercel = req.headers['x-vercel-cron'] === '1';

  if (!isCron && !isVercel) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: clients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ message: 'No active clients' });
    }

    const results = [];

    for (const client of clients) {
      const weekNo = calculateWeekNo(client.program_started_at);

      if (weekNo < 1) continue;

      const totalWeeks = client.program === '12wk' ? 12 : client.program.startsWith('zoom') ? 4 : 6;
      if (weekNo > totalWeeks) {
        await supabase.from('clients').update({ status: 'completed' }).eq('id', client.id);
        results.push({ client_id: client.id, action: 'completed' });
        continue;
      }

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) {
        results.push({ client_id: client.id, action: 'already_submitted' });
        continue;
      }

      const { data: missed } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const missedCount = weekNo - 1 - (missed?.length || 0);
      if (missedCount >= 2) {
        await escalateToMaddy('2 consecutive missed check-ins', {
          phone: client.phone,
          name: client.name,
          program: client.program,
          extra: `Week ${weekNo}, missed ${missedCount} check-ins`,
        });
      }

      const baseUrl = process.env.SITE_URL || 'https://fitnessbymaddy.com';
      const token = generateToken();
      const checkinUrl = `${baseUrl}/checkin?c=${client.id}&w=${weekNo}&t=${token}`;

      await sendWhatsApp(client.phone, 'weekly_checkin', [
        client.name || 'there',
        String(weekNo),
        checkinUrl,
      ]);

      results.push({ client_id: client.id, action: 'checkin_sent', week_no: weekNo });
    }

    return res.status(200).json({ processed: results.length, results });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateWeekNo(startDate) {
  if (!startDate) return 0;
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now - start;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.ceil(diffDays / 7);
}
