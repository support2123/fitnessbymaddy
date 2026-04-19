const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp, maskPhone } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = getSupabase();

  try {
    const { data: clients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.json({ success: true, message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let errors = 0;

    for (const client of clients) {
      try {
        const programStart = new Date(client.program_started_at);
        const now = new Date();
        const daysDiff = Math.floor((now - programStart) / (1000 * 60 * 60 * 24));
        const weekNo = Math.ceil(daysDiff / 7);

        if (weekNo < 1) continue;

        const { data: existing } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .maybeSingle();

        if (existing) continue;

        const baseUrl = process.env.VERCEL_PROJECT_URL || 'fitnessbymaddy.com';
        const checkinUrl = `https://${baseUrl}/checkin.html?c=${client.id}&w=${weekNo}`;

        const { data: missedCount } = await supabase
          .from('checkins')
          .select('id', { count: 'exact', head: true })
          .eq('client_id', client.id)
          .gte('week_no', weekNo - 2);

        const consecutiveMissed = weekNo > 2 && (missedCount?.count || 0) === 0;

        if (consecutiveMissed) {
          const maddyPhone = process.env.MADDY_PHONE || '+917082478374';
          await sendWhatsApp(
            maddyPhone,
            `2 consecutive missed check-ins: ${client.name || maskPhone(client.phone)} (${client.program})`,
            'escalation_alert'
          );
        }

        await sendWhatsApp(
          client.phone,
          `Hey ${client.name || 'there'}! Time for your Week ${weekNo} check-in. Fill it out here: ${checkinUrl}\n\nTakes just 2 minutes!`
        );

        sent++;
      } catch (clientErr) {
        console.error(`Checkin send failed for ${maskPhone(client.phone)}:`, clientErr.message);
        errors++;
      }
    }

    return res.json({ success: true, sent, errors, total_clients: clients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
