const { supabase } = require('../../lib/supabase');
const { sendToClient, notifyMaddy } = require('../../lib/whatsapp');
const { maskPhone } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: activeClients, error } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (error) {
      console.error('Failed to fetch active clients:', error.message);
      return res.status(500).json({ error: 'Database error' });
    }

    let sent = 0;
    let skipped = 0;

    for (const client of activeClients || []) {
      try {
        const weekNo = calculateWeekNo(client.program_started_at);

        if (weekNo <= 0) {
          skipped++;
          continue;
        }

        const { data: existing } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .limit(1)
          .single();

        if (existing) {
          skipped++;
          continue;
        }

        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

        await sendToClient(client.phone, 'weekly_checkin', [
          client.name || 'there',
          String(weekNo),
          checkinUrl,
        ]);

        sent++;

        const { count: missedCount } = await supabase
          .from('checkins')
          .select('*', { count: 'exact', head: true })
          .eq('client_id', client.id)
          .gte('week_no', weekNo - 2)
          .lte('week_no', weekNo - 1);

        if (weekNo >= 3 && (!missedCount || missedCount === 0)) {
          await notifyMaddy(
            '2 consecutive missed check-ins',
            `Client: ${maskPhone(client.phone)}, Name: ${client.name}, Week: ${weekNo}`
          );
        }
      } catch (clientErr) {
        console.error(`Error processing client ${client.id}:`, clientErr.message);
      }
    }

    console.log(`Weekly check-in cron: sent=${sent}, skipped=${skipped}`);
    return res.status(200).json({ status: 'completed', sent, skipped });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function calculateWeekNo(startDate) {
  if (!startDate) return 0;
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.ceil(diffDays / 7);
}
