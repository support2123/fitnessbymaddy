const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp, canSendMessage } = require('../../lib/whatsapp');
const { isHinglishMarket, detectMarket } = require('../../lib/utils');
const { checkMissedCheckins } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getSupabase();

    const { data: clients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.json({ sent: 0, message: 'No active clients' });
    }

    let sent = 0;
    const errors = [];

    for (const client of clients) {
      try {
        const weeksIn = Math.ceil(
          (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
        );

        if (weeksIn < 1) continue;

        const { data: existing } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weeksIn)
          .single();

        if (existing) continue;

        const allowed = await canSendMessage(client.phone);
        if (!allowed) continue;

        const market = detectMarket(client.phone);
        const hinglish = isHinglishMarket(market);
        const formUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weeksIn}`;

        const body = hinglish
          ? `Hi ${client.name || 'there'}! Week ${weeksIn} check-in time. Apna progress share karo — weight, waist, photos, aur kaise feel kar rahe ho.\n\n${formUrl}`
          : `Hi ${client.name || 'there'}! Time for your Week ${weeksIn} check-in. Share your progress — weight, waist, photos, and how you're feeling.\n\n${formUrl}`;

        await sendWhatsApp({
          phone: client.phone,
          templateName: 'weekly_checkin',
          body,
          params: [client.name || 'there', String(weeksIn), formUrl],
        });

        sent++;
      } catch (e) {
        errors.push({ client_id: client.id, error: e.message });
      }
    }

    await checkMissedCheckins(db);

    return res.json({ sent, total: clients.length, errors: errors.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
