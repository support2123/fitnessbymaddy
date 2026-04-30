const { supabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { notifyMaddy } = require('../_lib/escalation');
const { maskPhone } = require('../_lib/pii');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
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
    let escalated = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) continue;

      const { data: lastCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      const submittedWeeks = (lastCheckins || []).map(c => c.week_no);

      if (submittedWeeks.length >= 2) {
        const lastTwo = [currentWeek - 1, currentWeek - 2];
        const missedBoth = lastTwo.every(w => !submittedWeeks.includes(w));
        if (missedBoth) {
          await notifyMaddy('2 consecutive missed check-ins', {
            client_id: client.id,
            client_name: client.name,
            phone: maskPhone(client.phone),
            current_week: currentWeek
          }, sendWhatsApp);
          escalated++;
        }
      }

      if (submittedWeeks.includes(currentWeek)) continue;

      const isHinglish = client.phone.startsWith('91');
      const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;

      const msg = isHinglish
        ? `Hey ${client.name || ''}! Week ${currentWeek} ka check-in time aa gaya hai.\n\nYahan apna progress submit karo:\n${checkinUrl}\n\nWeight, waist, photos, aur apna feedback — sab bharna.`
        : `Hey ${client.name || ''}! Time for your Week ${currentWeek} check-in.\n\nSubmit your progress here:\n${checkinUrl}\n\nWeight, waist, photos, and feedback — fill it all in.`;

      await sendWhatsApp(client.phone, msg);
      sent++;
    }

    console.log(`Weekly check-in cron: sent=${sent}, escalated=${escalated}`);
    return res.status(200).json({ sent, escalated, total: activeClients.length });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
