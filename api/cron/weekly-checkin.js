const { supabase } = require('../lib/supabase');
const { sendWhatsApp, notifyMaddy, maskPhone } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
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
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) continue;

      const { data: existingCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existingCheckin) continue;

      const { data: missedCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const expectedWeeks = Array.from({ length: weekNo - 1 }, (_, i) => i + 1);
      const submittedWeeks = (missedCheckins || []).map(c => c.week_no);
      const missed = expectedWeeks.filter(w => !submittedWeeks.includes(w));

      if (missed.length >= 2) {
        await notifyMaddy(
          '2+ missed check-ins',
          `Client ${maskPhone(client.phone)} (${client.name || 'Unknown'}) missed weeks: ${missed.slice(-2).join(', ')}`
        );
        escalated++;
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

      await sendWhatsApp(client.phone, 'weekly_checkin', {
        name: client.name || 'there',
        templateParams: [
          client.name || 'there',
          `Week ${weekNo}`,
          checkinUrl
        ]
      });

      sent++;
    }

    return res.status(200).json({
      message: 'Weekly check-in cron complete',
      sent,
      escalated,
      total_clients: activeClients.length
    });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
