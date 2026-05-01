const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, sendText } = require('../../lib/whatsapp');
const { detectMarket, isHinglish } = require('../../lib/market');
const { checkMissedCheckins } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getSupabase();
  const results = { sent: 0, skipped: 0, errors: 0 };

  try {
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients', results });
    }

    for (const client of activeClients) {
      try {
        const weeksSinceStart = Math.max(1, Math.ceil(
          (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
        ));

        if (client.program_ends_at && new Date(client.program_ends_at) < new Date()) {
          continue;
        }

        const { data: existingCheckin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weeksSinceStart)
          .single();

        if (existingCheckin) {
          results.skipped++;
          continue;
        }

        const baseUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
          ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
          : 'https://fitnessbymaddy.com';

        const checkinUrl = `${baseUrl}/checkin?c=${client.id}&w=${weeksSinceStart}`;
        const market = detectMarket(client.phone);
        const hinglish = isHinglish(market);

        const msg = hinglish
          ? `Hey ${client.name || 'there'}! 📋 Week ${weeksSinceStart} check-in time. Apna progress share karo:\n\n${checkinUrl}`
          : `Hey ${client.name || 'there'}! 📋 Time for your Week ${weeksSinceStart} check-in. Share your progress:\n\n${checkinUrl}`;

        await sendText(client.phone, msg);
        results.sent++;

        await checkMissedCheckins(client.id);
      } catch (clientErr) {
        console.error(`Checkin send error for client:`, clientErr.message);
        results.errors++;
      }
    }

    return res.status(200).json({ ok: true, results });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
