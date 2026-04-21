const { supabase } = require('../../lib/supabase');
const { sendTextMessage, sendTemplate } = require('../../lib/whatsapp');
const { getLanguage } = require('../../lib/market');
const { checkMissedCheckins } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: clients, error } = await supabase
      .from('clients')
      .select('id, phone, name, program, program_started_at, leads(market)')
      .eq('status', 'active');

    if (error) {
      console.error('Fetch clients error:', error.message);
      return res.status(500).json({ error: 'Failed to fetch clients' });
    }

    let sent = 0;
    let nudged = 0;
    let escalated = 0;

    for (const client of clients || []) {
      const weekNo = calculateWeekNo(client.program_started_at);
      if (weekNo < 1) continue;

      const { data: existingCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .maybeSingle();

      if (existingCheckin) continue;

      const market = client.leads?.market || 'GLOBAL';
      const lang = getLanguage(market);
      const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

      let msg;
      if (lang === 'hinglish') {
        msg = `Hey ${client.name || 'there'}! 📋 Week ${weekNo} ka check-in time hai.\n\nApna progress yahan submit karo:\n${checkinUrl}\n\nWeight, waist, photos, aur feel — sab batao!`;
      } else {
        msg = `Hey ${client.name || 'there'}! 📋 It's time for your Week ${weekNo} check-in.\n\nSubmit your progress here:\n${checkinUrl}\n\nWeight, waist, photos, and how you're feeling — tell us everything!`;
      }

      await sendTextMessage(client.phone, msg);
      sent++;

      const missed = await checkMissedCheckins(client.id);
      if (missed) escalated++;
    }

    const pendingNudges = await scheduleNudges(clients || []);

    return res.status(200).json({
      ok: true,
      sent,
      total_clients: (clients || []).length,
      escalated,
    });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function calculateWeekNo(programStartedAt) {
  if (!programStartedAt) return 0;
  const start = new Date(programStartedAt);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  return Math.floor(diffDays / 7) + 1;
}

async function scheduleNudges(clients) {
  // Nudge logic is handled by the nudge-dropped cron
  // This function is a placeholder for any immediate nudge scheduling
  return 0;
}
