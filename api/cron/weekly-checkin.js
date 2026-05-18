const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { isHinglishMarket, maskPhone, jsonResponse, errorResponse } = require('../_lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return errorResponse(res, 'GET or POST only', 405);
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return errorResponse(res, 'Unauthorized', 401);
  }

  const db = getSupabase();

  const { data: activeClients } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active')
    .lte('program_started_at', new Date().toISOString());

  if (!activeClients || activeClients.length === 0) {
    return jsonResponse(res, { ok: true, sent: 0 });
  }

  let sentCount = 0;

  for (const client of activeClients) {
    const startDate = new Date(client.program_started_at);
    const now = new Date();
    const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
    const weekNo = Math.max(1, Math.ceil(daysSinceStart / 7));

    const { data: existing } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .maybeSingle();

    if (existing) continue;

    const { data: lead } = client.lead_id
      ? await db.from('leads').select('market').eq('id', client.lead_id).maybeSingle()
      : { data: null };

    const market = lead?.market || 'GLOBAL';
    const hinglish = isHinglishMarket(market);
    const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

    if (hinglish) {
      await sendWhatsApp(client.phone, 'weekly_checkin', [
        client.name || 'there',
        `${weekNo}`,
        checkinUrl,
      ]);
    } else {
      await sendWhatsApp(client.phone, 'weekly_checkin', [
        client.name || 'there',
        `${weekNo}`,
        checkinUrl,
      ]);
    }

    sentCount++;
    console.log(`Check-in sent: ${maskPhone(client.phone)} week ${weekNo}`);
  }

  return jsonResponse(res, { ok: true, sent: sentCount });
};
