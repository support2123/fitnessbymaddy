const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { isHinglish } = require('../_lib/market');
const { escalateToMaddy } = require('../_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    const { data: clients } = await db
      .from('clients')
      .select('*, leads(market)')
      .eq('status', 'active')
      .lte('program_started_at', now.toISOString());

    if (!clients || clients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of clients) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) continue;

      const { data: existingCheckin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1)
        .single();

      if (existingCheckin) continue;

      const { data: missedCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const submittedWeeks = missedCheckins ? missedCheckins.map(c => c.week_no) : [];
      let consecutiveMissed = 0;
      for (let w = weekNo - 1; w >= 1 && consecutiveMissed < 2; w--) {
        if (!submittedWeeks.includes(w)) {
          consecutiveMissed++;
        } else {
          break;
        }
      }

      if (consecutiveMissed >= 2) {
        await escalateToMaddy({
          reason: '2_consecutive_missed_checkins',
          phone: client.phone,
          message: `Client ${client.name || client.phone} has missed ${consecutiveMissed} consecutive check-ins.`
        });
        escalated++;
      }

      const market = client.leads?.market || 'GLOBAL';
      const hinglish = isHinglish(market);
      const formUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

      const msg = hinglish
        ? `Hey ${client.name || 'there'}! Week ${weekNo} ka check-in time aa gaya hai. Apna progress yahan submit karo: ${formUrl}`
        : `Hey ${client.name || 'there'}! It's time for your Week ${weekNo} check-in. Submit your progress here: ${formUrl}`;

      await sendWhatsApp({
        phone: client.phone,
        templateName: 'weekly_checkin',
        body: msg,
        params: [client.name || 'there', String(weekNo), formUrl]
      });

      sent++;
    }

    return res.status(200).json({ message: 'Weekly check-ins sent', sent, escalated });

  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
