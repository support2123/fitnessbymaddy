const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, sendText, notifyMaddy } = require('../../lib/whatsapp');
const { isHinglish, maskPhone, jsonResponse } = require('../../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: clients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return jsonResponse(res, { status: 'ok', sent: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of clients) {
      const weekNo = calculateCurrentWeek(client.program_started_at);
      const maxWeeks = client.program === '12wk' ? 12 : 6;

      if (weekNo > maxWeeks) {
        await db.from('clients').update({ status: 'completed' }).eq('id', client.id);
        continue;
      }

      const { data: existing } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) continue;

      const { count: missedCount } = await db
        .from('checkins')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', client.id)
        .gte('week_no', weekNo - 2)
        .lte('week_no', weekNo - 1);

      const expectedCheckins = Math.min(2, weekNo - 1);
      const actualMissed = expectedCheckins - (missedCount || 0);

      if (actualMissed >= 2) {
        await notifyMaddy(
          '2 consecutive missed check-ins',
          `Client: ${client.name} (${maskPhone(client.phone)})\nProgram: ${client.program}\nWeek: ${weekNo}`
        );
        escalated++;
      }

      const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

      const market = client.phone?.startsWith('+91') ? 'IN' : 'GLOBAL';
      if (isHinglish(market)) {
        await sendText(client.phone,
          `📋 Week ${weekNo} check-in time!\n\nApna progress yahan submit karo: ${checkinUrl}\n\nWeight, waist, photos aur compliance — sab fill karo. Maddy tera next week plan iske basis pe banayegi! 💪`
        );
      } else {
        await sendText(client.phone,
          `📋 Week ${weekNo} check-in time!\n\nSubmit your progress here: ${checkinUrl}\n\nWeight, waist, photos, and compliance — fill everything out. Maddy will build your next week's plan based on this! 💪`
        );
      }

      sent++;
    }

    return jsonResponse(res, { status: 'ok', sent, escalated, total: clients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateCurrentWeek(startDate) {
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now - start;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.max(1, Math.ceil(diffDays / 7));
}
