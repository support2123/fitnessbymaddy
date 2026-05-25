const { getClient } = require('../../lib/supabase');
const { sendMessage } = require('../../lib/whatsapp');
const { isHinglish, detectMarket } = require('../../lib/market');
const { checkMissedCheckins } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getClient();
    const siteBase = process.env.SITE_URL || 'https://fitnessbymaddy.com';

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
      const startDate = new Date(client.program_started_at);
      const weekNo = Math.ceil((Date.now() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000));
      const maxWeeks = client.program === '12wk' ? 12 : client.program === 'pcos' || client.program === '40plus' ? 8 : 6;

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

      await checkMissedCheckins(client.id, db);

      const checkinUrl = `${siteBase}/checkin?c=${client.id}&w=${weekNo}`;
      const market = detectMarket(client.phone);
      const hinglish = isHinglish(market);

      const msg = hinglish
        ? `Hey ${client.name || 'there'}! 📋 Week ${weekNo} ka check-in time hai.\n\nApna progress update karo: ${checkinUrl}\n\nWeight, waist, photos aur apna honest feedback dena. Ye important hai for your next week's plan! 💪`
        : `Hey ${client.name || 'there'}! 📋 It's Week ${weekNo} check-in time.\n\nUpdate your progress here: ${checkinUrl}\n\nShare your weight, waist, photos and honest feedback — it's key to planning your next week! 💪`;

      await sendMessage(client.phone, msg, {
        isClient: true,
        templateName: 'weekly_checkin',
        params: {
          name: client.name || 'there',
          templateParams: [client.name || 'there', String(weekNo), checkinUrl]
        }
      });

      sent++;
    }

    return res.status(200).json({ message: 'Weekly check-in sent', sent, nudged });

  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
