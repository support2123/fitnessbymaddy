const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { isHinglish, detectMarket } = require('../../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: leads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .gte('created_at', fourteenDaysAgo)
      .lte('created_at', sevenDaysAgo);

    if (!leads || leads.length === 0) {
      return res.status(200).json({ message: 'No leads to nudge', nudged: 0 });
    }

    let nudged = 0;

    for (const lead of leads) {
      const { data: recentMsg } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'nudge_reengagement')
        .limit(1);

      if (recentMsg && recentMsg.length > 0) continue;

      const hinglish = isHinglish(lead.market);
      const templateName = hinglish ? 'nudge_reengagement' : 'nudge_reengagement_en';
      await sendTemplate(lead.phone, templateName, [lead.name || 'there']);
      nudged++;
    }

    await nudgePendingCheckins();

    return res.status(200).json({ message: 'Nudge cycle complete', nudged });

  } catch (err) {
    console.error('nudge-dropped cron error:', err.message);
    return res.status(500).json({ error: 'Cron job failed' });
  }
};

async function nudgePendingCheckins() {
  const { data: activeClients } = await supabase
    .from('clients')
    .select('*')
    .eq('status', 'active');

  if (!activeClients) return;

  for (const client of activeClients) {
    const startDate = new Date(client.program_started_at);
    const now = new Date();
    const weeksSinceStart = Math.floor((now - startDate) / (7 * 24 * 60 * 60 * 1000));
    const currentWeek = weeksSinceStart + 1;

    const { data: checkin } = await supabase
      .from('checkins')
      .select('id, form_submitted_at')
      .eq('client_id', client.id)
      .eq('week_no', currentWeek)
      .limit(1);

    if (checkin && checkin.length > 0) continue;

    const dayOfWeek = now.getDay();
    if (dayOfWeek === 1 || dayOfWeek === 2) {
      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;
      const market = detectMarket(client.phone);

      if (isHinglish(market)) {
        await sendTemplate(client.phone, 'checkin_reminder', [
          client.name || 'there',
          String(currentWeek),
          checkinUrl
        ]);
      } else {
        await sendTemplate(client.phone, 'checkin_reminder_en', [
          client.name || 'there',
          String(currentWeek),
          checkinUrl
        ]);
      }
    }
  }
}
