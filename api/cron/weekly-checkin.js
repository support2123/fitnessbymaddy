const { supabase } = require('../_lib/supabase');
const { sendText, canSendToLead, maskPhone } = require('../_lib/whatsapp');
const { detectMarket } = require('../_lib/utils');
const { checkMissedCheckins } = require('../_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    if (!req.headers['x-vercel-cron']) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    const { data: clients, error } = await supabase
      .from('clients')
      .select('id, phone, name, program, program_started_at')
      .eq('status', 'active');

    if (error) {
      console.error('Fetch clients error:', error.message);
      return res.status(500).json({ error: 'Failed to fetch clients' });
    }

    let sent = 0;
    let skipped = 0;

    for (const client of clients || []) {
      const weeksSinceStart = Math.ceil(
        (Date.now() - new Date(client.program_started_at).getTime()) /
          (7 * 24 * 60 * 60 * 1000)
      );

      const weekNo = Math.max(1, weeksSinceStart);

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

      const market = detectMarket(client.phone);
      const isHinglish = market === 'IN';
      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

      const msg = isHinglish
        ? `Hey ${client.name || 'there'}! 💪 Week ${weekNo} check-in time! Apna progress yahan submit karo:\n${checkinUrl}\n\nWeight, waist, photos aur energy level daalna mat bhoolna.`
        : `Hey ${client.name || 'there'}! 💪 Time for your Week ${weekNo} check-in! Submit your progress here:\n${checkinUrl}\n\nDon't forget to include weight, waist, photos, and energy level.`;

      await sendText(client.phone, msg);
      sent++;
      console.log(`Check-in sent: ${maskPhone(client.phone)} week ${weekNo}`);
    }

    await checkMissedCheckins(supabase);

    return res.status(200).json({
      ok: true,
      sent,
      skipped,
      total: (clients || []).length,
    });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
