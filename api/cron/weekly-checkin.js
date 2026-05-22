const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { notifyMaddy } = require('../lib/escalation');
const { maskPhone } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let errors = 0;

    for (const client of activeClients) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.ceil(daysSinceStart / 7);

        if (weekNo < 1) continue;

        const { data: existingCheckin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .limit(1);

        if (existingCheckin && existingCheckin.length > 0) continue;

        const { data: missedCheckins } = await supabase
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(3);

        const submittedWeeks = missedCheckins ? missedCheckins.map(c => c.week_no) : [];
        let consecutiveMissed = 0;
        for (let w = weekNo - 1; w >= Math.max(1, weekNo - 2); w--) {
          if (!submittedWeeks.includes(w)) consecutiveMissed++;
          else break;
        }

        if (consecutiveMissed >= 2) {
          await notifyMaddy('2 consecutive missed check-ins', {
            client_id: client.id,
            phone: maskPhone(client.phone),
            name: client.name,
            missed_weeks: consecutiveMissed,
          }, sendWhatsApp);
        }

        const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
        const msg = `Hey ${client.name || 'there'}! Time for your Week ${weekNo} check-in.\n\nFill it out here: ${checkinUrl}\n\nThis helps us tailor your next week's plan perfectly.`;

        await sendWhatsApp(client.phone, msg, null, true);
        sent++;
      } catch (clientErr) {
        console.error(`Check-in send failed for ${maskPhone(client.phone)}:`, clientErr.message);
        errors++;
      }
    }

    return res.status(200).json({ sent, errors, total_clients: activeClients.length });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
