const { supabase } = require('../_lib/supabase');
const { canSendMessage, sendTemplate } = require('../_lib/whatsapp');
const { isHinglishMarket } = require('../_lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    // Nudge leads that went silent 2hrs+ after first contact but within 24hrs
    const { data: newLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    let nudged = 0;
    for (const lead of (newLeads || [])) {
      const allowed = await canSendMessage(lead.phone, false);
      if (!allowed) continue;

      const template = isHinglishMarket(lead.market)
        ? 'nudge_trial'
        : 'nudge_trial_en';

      await sendTemplate(lead.phone, template, [
        lead.name || 'there',
        'https://fitnessbymaddy.com/shred.html',
      ]);
      nudged++;
    }

    // Mark 24hr+ silent leads as dropped
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await supabase
      .from('leads')
      .update({ status: 'dropped' })
      .eq('status', 'new')
      .lt('last_msg_at', oneDayAgo);

    // Re-engage dropped leads from 7 days ago (one-time reactivation)
    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('created_at', sevenDaysAgo)
      .lt('created_at', new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString());

    let reengaged = 0;
    for (const lead of (droppedLeads || [])) {
      const allowed = await canSendMessage(lead.phone, false);
      if (!allowed) continue;

      const { count } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'reengage_7day');

      if ((count || 0) > 0) continue;

      await sendTemplate(lead.phone, 'reengage_7day', [
        lead.name || 'there',
      ]);
      reengaged++;
    }

    // Check for clients with 2+ consecutive missed check-ins
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';
    for (const client of (activeClients || [])) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const currentWeek = Math.floor((now - startDate) / (1000 * 60 * 60 * 24 * 7)) + 1;

      if (currentWeek < 3) continue;

      const { data: recentCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .gte('week_no', currentWeek - 2);

      if (!recentCheckins || recentCheckins.length === 0) {
        const { sendText } = require('../_lib/whatsapp');
        const { maskPhone } = require('../_lib/utils');
        await sendText(MADDY_PHONE,
          `MISSED CHECK-INS: ${maskPhone(client.phone)} has missed 2+ consecutive check-ins (current week: ${currentWeek}).`
        );
      }
    }

    return res.json({ ok: true, nudged, reengaged });
  } catch (err) {
    console.error('nudge-dropped cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
