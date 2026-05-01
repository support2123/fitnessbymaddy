const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../send-whatsapp');
const { maskPhone, isHinglish, detectMarket, jsonResponse } = require('../lib/helpers');

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
  const now = new Date();

  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const fourteenDaysAgo = new Date(now);
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

  const { data: leads } = await supabase
    .from('leads')
    .select('id, phone, name, market, last_msg_at, status')
    .eq('status', 'new')
    .gte('created_at', fourteenDaysAgo.toISOString())
    .lte('last_msg_at', sevenDaysAgo.toISOString());

  if (!leads || leads.length === 0) {
    return jsonResponse(res, 200, { nudged: 0 });
  }

  let nudged = 0;

  for (const lead of leads) {
    const { count } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('phone', lead.phone)
      .eq('direction', 'out')
      .eq('template_name', 'nudge_trial');

    if (count && count >= 2) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
      continue;
    }

    const market = detectMarket(lead.phone);
    const hinglish = isHinglish(market);

    await sendWhatsApp({
      phone: lead.phone,
      templateName: hinglish ? 'nudge_trial_hi' : 'nudge_trial',
      bodyValues: [
        lead.name || 'there',
        '$20',
        'https://fitnessbymaddy.com/program-trial.html',
      ],
    });

    nudged++;
    console.log(`Nudge sent: ${maskPhone(lead.phone)}`);
  }

  const twoHoursAgo = new Date(now);
  twoHoursAgo.setDate(twoHoursAgo.getDate());
  twoHoursAgo.setHours(twoHoursAgo.getHours() - 2);

  const { data: freshLeads } = await supabase
    .from('leads')
    .select('id, phone, name, market')
    .eq('status', 'new')
    .lte('created_at', twoHoursAgo.toISOString())
    .gte('created_at', new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString());

  if (freshLeads) {
    for (const lead of freshLeads) {
      const { count } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'nudge_trial');

      if (count && count > 0) continue;

      const market = detectMarket(lead.phone);
      const hinglish = isHinglish(market);

      await sendWhatsApp({
        phone: lead.phone,
        templateName: hinglish ? 'nudge_trial_hi' : 'nudge_trial',
        bodyValues: [lead.name || 'there', '$20', 'https://fitnessbymaddy.com/program-trial.html'],
      });

      nudged++;
    }
  }

  console.log(`Nudge cron: nudged=${nudged}`);
  return jsonResponse(res, 200, { nudged });
};
