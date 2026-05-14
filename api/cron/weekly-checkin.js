import supabase from '../../lib/supabase.js';
import { sendTemplate } from '../../lib/whatsapp.js';
import { isHinglish, detectMarket, jsonResponse } from '../../lib/utils.js';

const SITE = 'https://www.fitnessbymaddy.com';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse(res, 405, { error: 'Method not allowed' });
  }

  try {
    const { data: clients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return jsonResponse(res, 200, { sent: 0 });
    }

    let sent = 0;
    for (const client of clients) {
      const weekNo = calculateCurrentWeek(client.program_started_at);

      if (weekNo < 1) continue;

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .maybeSingle();

      if (existing) continue;

      const checkinUrl = `${SITE}/checkin.html?c=${client.id}&w=${weekNo}`;
      const market = detectMarket(client.phone);
      const hinglish = isHinglish(market);

      const msg = hinglish
        ? `Hey ${client.name || ''} 👋 Week ${weekNo} ka check-in time!\n\n` +
          `📋 Form fill karo: ${checkinUrl}\n\n` +
          `Weight, waist, photos aur kaise feel ho raha hai — sab batao!`
        : `Hey ${client.name || ''} 👋 Time for your Week ${weekNo} check-in!\n\n` +
          `📋 Fill it here: ${checkinUrl}\n\n` +
          `Share your weight, waist, photos and how you're feeling!`;

      await sendTemplate(client.phone, 'weekly_checkin', [msg]);
      sent++;
    }

    return jsonResponse(res, 200, { ok: true, sent });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return jsonResponse(res, 500, { error: 'Internal error' });
  }
}

function calculateCurrentWeek(startDate) {
  if (!startDate) return 0;
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  return Math.ceil(diffMs / (7 * 24 * 60 * 60 * 1000));
}
