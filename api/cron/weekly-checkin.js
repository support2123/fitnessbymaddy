const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../send-whatsapp');
const { maskPhone, isHinglish, detectMarket, jsonResponse } = require('../lib/helpers');

const SITE = 'https://fitnessbymaddy.com';

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse(res, 405, { error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const isAuthed = authHeader === `Bearer ${process.env.CRON_SECRET}` || isVercelCron;
  if (!isAuthed && process.env.NODE_ENV === 'production') {
    return jsonResponse(res, 401, { error: 'Unauthorized' });
  }

  const supabase = getSupabase();

  const { data: clients } = await supabase
    .from('clients')
    .select('id, phone, name, program, program_started_at, status')
    .eq('status', 'active');

  if (!clients || clients.length === 0) {
    return jsonResponse(res, 200, { sent: 0, message: 'No active clients' });
  }

  let sent = 0;
  let nudged = 0;

  for (const client of clients) {
    const startDate = new Date(client.program_started_at);
    const now = new Date();
    const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
    const weekNo = Math.max(1, Math.ceil(daysSinceStart / 7));

    const { data: existing } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .single();

    if (existing) continue;

    const { data: lastCheckin } = await supabase
      .from('checkins')
      .select('week_no, form_submitted_at')
      .eq('client_id', client.id)
      .order('week_no', { ascending: false })
      .limit(1);

    const missedConsecutive = lastCheckin && lastCheckin.length > 0
      ? weekNo - lastCheckin[0].week_no - 1
      : 0;

    if (missedConsecutive >= 2) {
      await sendWhatsApp({
        phone: '+' + (process.env.MADDY_PHONE || '917082478374'),
        templateName: 'escalation_alert',
        bodyValues: [
          client.name || 'Client',
          `${missedConsecutive} consecutive missed check-ins. Needs follow-up.`
        ],
        isClient: true,
      });
    }

    const market = detectMarket(client.phone);
    const hinglish = isHinglish(market);
    const link = `${SITE}/checkin?c=${client.id}&w=${weekNo}`;

    await sendWhatsApp({
      phone: client.phone,
      templateName: hinglish ? 'weekly_checkin_hi' : 'weekly_checkin',
      bodyValues: [client.name || 'there', String(weekNo), link],
      isClient: true,
    });

    sent++;
    console.log(`Check-in sent: ${maskPhone(client.phone)} week=${weekNo}`);
  }

  console.log(`Weekly check-in cron: sent=${sent} total_clients=${clients.length}`);
  return jsonResponse(res, 200, { sent, total: clients.length });
};
