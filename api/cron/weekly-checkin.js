const supabase = require('../../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients' });
    }

    let sent = 0;
    let skipped = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const weekNo = calculateWeekNo(client.program_started_at);

      if (weekNo < 1) {
        skipped++;
        continue;
      }

      const maxWeeks = client.program === '12wk' ? 12 : 6;
      if (weekNo > maxWeeks) {
        await supabase
          .from('clients')
          .update({ status: 'completed' })
          .eq('id', client.id);
        skipped++;
        continue;
      }

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) {
        skipped++;
        continue;
      }

      const { data: missedCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      const lastSubmitted = missedCheckins?.[0]?.week_no || 0;
      const missedCount = weekNo - lastSubmitted - 1;

      if (missedCount >= 2) {
        await notifyMaddy(
          '2 Consecutive Missed Check-ins',
          `Client: ${client.name || client.phone}\nProgram: ${client.program}\nLast submitted: Week ${lastSubmitted}\nCurrent: Week ${weekNo}`
        );
        escalated++;
      }

      const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

      await sendTemplate(client.phone, 'weekly_checkin', {
        name: client.name || 'there',
        templateParams: [
          client.name || 'there',
          `${weekNo}`,
          checkinUrl
        ]
      });

      sent++;
    }

    return res.status(200).json({
      message: 'Weekly check-in cron complete',
      sent,
      skipped,
      escalated,
      total: activeClients.length
    });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
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
