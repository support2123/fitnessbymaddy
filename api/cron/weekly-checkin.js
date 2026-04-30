const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { isHinglishMarket } = require('../lib/market');
const { escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !isVercelCron(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('*, leads!clients_lead_id_fkey(market)')
      .eq('status', 'active')
      .not('program_started_at', 'is', null);

    if (!activeClients?.length) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const weekNo = calculateWeekNo(client.program_started_at);
      if (weekNo < 1) continue;

      const maxWeeks = client.program === '12wk' ? 12 : 6;
      if (weekNo > maxWeeks) continue;

      const { data: existingCheckin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existingCheckin) continue;

      const { data: missedCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const lastTwoWeeks = [weekNo - 1, weekNo - 2];
      const submittedWeeks = (missedCheckins || []).map(c => c.week_no);
      const consecutiveMissed = lastTwoWeeks.every(w => w > 0 && !submittedWeeks.includes(w));

      if (consecutiveMissed && weekNo > 2) {
        await escalateToMaddy({
          reason: '2 consecutive missed check-ins',
          phone: client.phone,
          clientName: client.name,
          messageText: `Client has missed check-ins for weeks ${weekNo - 2} and ${weekNo - 1}`
        });
        escalated++;
      }

      const market = client.leads?.market || 'GLOBAL';
      const hinglish = isHinglishMarket(market);
      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

      await sendWhatsApp({
        phone: client.phone,
        templateName: 'weekly_checkin',
        body: hinglish
          ? `Hey ${client.name}! 📋\n\nWeek ${weekNo} ka check-in time aa gaya! Apni progress share karo:\n\n${checkinUrl}\n\nWeight, waist measurement, photos, aur batao kaise chal raha hai! 💪`
          : `Hey ${client.name}! 📋\n\nIt's time for your Week ${weekNo} check-in! Share your progress:\n\n${checkinUrl}\n\nWeight, waist measurement, photos, and let us know how it's going! 💪`,
        params: {
          name: client.name,
          templateParams: [client.name, `${weekNo}`, checkinUrl]
        }
      });

      sent++;
    }

    return res.status(200).json({ message: 'Check-in reminders sent', sent, escalated });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateWeekNo(startDate) {
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.ceil(diffDays / 7);
}

function isVercelCron(req) {
  return req.headers['x-vercel-cron'] === '1';
}
