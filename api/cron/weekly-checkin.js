const { supabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { json } = require('../_lib/helpers');

module.exports = async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return json(res, 401, { error: 'Unauthorized' });
  }

  const { data: clients } = await supabase
    .from('clients')
    .select('*')
    .eq('status', 'active');

  if (!clients || clients.length === 0) {
    return json(res, 200, { sent: 0 });
  }

  let sent = 0;
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
      .limit(1)
      .single();

    if (existing) continue;

    const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
    const isHinglish = client.phone.startsWith('91');

    const msg = isHinglish
      ? `📊 Week ${weekNo} Check-in Time!\n\n` +
        `Hey ${client.name || 'there'}! Weekly check-in ka time aa gaya hai.\n\n` +
        `👉 ${checkinUrl}\n\n` +
        `Weight, waist, photos aur feedback daal de — tere next week ka plan iske basis pe banega! 💪`
      : `📊 Week ${weekNo} Check-in Time!\n\n` +
        `Hey ${client.name || 'there'}! Time for your weekly check-in.\n\n` +
        `👉 ${checkinUrl}\n\n` +
        `Submit your weight, waist, photos and feedback — your next week's plan will be based on this! 💪`;

    await sendWhatsApp({ phone: client.phone, body: msg });
    sent++;
  }

  return json(res, 200, { sent, total_active: clients.length });
};
