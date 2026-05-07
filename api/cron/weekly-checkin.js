const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { checkMissedCheckins } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_KEY}`) {
    if (!req.headers['x-vercel-cron']) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    const db = getSupabase();

    const { data: clients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let nudged = 0;

    for (const client of clients) {
      const weekNo = calculateWeekNo(client.program_started_at);
      if (weekNo < 1) continue;

      const maxWeeks = client.program === '12wk' ? 12 : 6;
      if (weekNo > maxWeeks) continue;

      const { data: existing } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (existing && existing.length > 0) continue;

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const hinglish = isHinglish(detectMarket(client.phone));

      const msg = hinglish
        ? `Hey ${client.name || 'champion'}! 📋\n\nWeek ${weekNo} ka check-in time hai!\n\n📝 Form: ${checkinUrl}\n\nWeight, waist, photos aur apna mood share karo. Ye teri progress track karne mein help karega 💪`
        : `Hey ${client.name || 'champion'}! 📋\n\nTime for your Week ${weekNo} check-in!\n\n📝 Form: ${checkinUrl}\n\nShare your weight, waist, photos and how you're feeling. This helps us track your progress 💪`;

      await sendWhatsApp({ phone: client.phone, body: msg });
      sent++;

      await checkMissedCheckins(client.id, client.phone);

      const { data: prevWeekCheckin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo - 1)
        .limit(1);

      if (weekNo > 1 && (!prevWeekCheckin || prevWeekCheckin.length === 0)) {
        const nudgeMsg = hinglish
          ? `Reminder: Week ${weekNo - 1} ka check-in abhi tak nahi aaya! 🙏 Please jaldi bhej do — tera plan isi pe depend karta hai.`
          : `Reminder: We haven't received your Week ${weekNo - 1} check-in yet! 🙏 Please submit it — your next plan depends on it.`;

        await sendWhatsApp({ phone: client.phone, body: nudgeMsg });
        nudged++;
      }
    }

    return res.status(200).json({ success: true, sent, nudged, total: clients.length });

  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateWeekNo(programStartedAt) {
  const start = new Date(programStartedAt);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  return Math.ceil(diffMs / (7 * 24 * 60 * 60 * 1000));
}
