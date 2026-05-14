const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('../lib/whatsapp');
const { isHinglish, detectMarket, maskPhone } = require('../lib/market');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !process.env.VERCEL_URL) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = getSupabase();

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients', processed: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

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

      const submittedWeeks = (missedCheckins || []).map(c => c.week_no);
      let consecutiveMissed = 0;
      for (let w = weekNo - 1; w >= 1 && !submittedWeeks.includes(w); w--) {
        consecutiveMissed++;
      }

      if (consecutiveMissed >= 2) {
        await notifyMaddy(
          '2 consecutive missed check-ins',
          `Client: ${client.name || maskPhone(client.phone)}\nProgram: ${client.program}\nMissed weeks: ${consecutiveMissed}`
        );
        escalated++;
      }

      const market = detectMarket(client.phone);
      const hinglish = isHinglish(market);
      const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

      const msg = hinglish
        ? `Hey ${client.name || 'there'}! Week ${weekNo} ka check-in time aa gaya. Apna progress update karo:\n${checkinUrl}`
        : `Hey ${client.name || 'there'}! Time for your Week ${weekNo} check-in. Update your progress here:\n${checkinUrl}`;

      await sendWhatsApp({
        phone: client.phone,
        body: msg,
        isClient: true
      });

      sent++;
    }

    return res.status(200).json({
      message: 'Weekly check-in reminders sent',
      processed: activeClients.length,
      sent,
      escalated
    });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
