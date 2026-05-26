const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { escalateToMaddy, maskPhone } = require('../lib/escalation');
const { isHinglishMarket } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    const errors = [];

    for (const client of activeClients) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.ceil(daysSinceStart / 7);

        if (weekNo < 1) continue;

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
        const submittedWeeks = (missedCheckins || []).map((c) => c.week_no);
        const consecutiveMisses = lastTwoWeeks.filter(
          (w) => w > 0 && !submittedWeeks.includes(w)
        ).length;

        if (consecutiveMisses >= 2) {
          await escalateToMaddy(
            '2 consecutive missed check-ins',
            `Client: ${maskPhone(client.phone)}\nName: ${client.name}\nProgram: ${client.program}\nMissed weeks: ${lastTwoWeeks.join(', ')}`
          );
        }

        const { data: lead } = client.lead_id
          ? await db.from('leads').select('market').eq('id', client.lead_id).single()
          : { data: null };

        const hinglish = isHinglishMarket(lead?.market || 'IN');
        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

        const msg = hinglish
          ? `Hey ${client.name || ''}! Week ${weekNo} check-in time.\n\nApna weight, waist, photos aur progress yahan submit karo:\n${checkinUrl}\n\nYeh important hai — isse hum next week ka plan adjust karte hain!`
          : `Hey ${client.name || ''}! Time for your Week ${weekNo} check-in.\n\nSubmit your weight, waist, photos and progress here:\n${checkinUrl}\n\nThis is important — it helps us adjust your plan for next week!`;

        await sendWhatsApp(client.phone, msg, 'weekly_checkin');
        sent++;
      } catch (clientErr) {
        errors.push({ client_id: client.id, error: clientErr.message });
      }
    }

    return res.status(200).json({
      message: `Check-in reminders sent`,
      sent,
      total_clients: activeClients.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
