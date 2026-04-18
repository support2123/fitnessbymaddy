const { supabase } = require('../_lib/supabase');
const { sendTemplate, canSendToLead } = require('../_lib/whatsapp');
const { isHinglishMarket, maskPhone } = require('../_lib/utils');

const NUDGE_WINDOW_DAYS = 7;
const MIN_AGE_HOURS = 2;
const MAX_AGE_DAYS = 30;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const now = new Date();
    const twoHoursAgo = new Date(now - MIN_AGE_HOURS * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now - MAX_AGE_DAYS * 24 * 60 * 60 * 1000);

    const { data: newLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo.toISOString())
      .gt('created_at', thirtyDaysAgo.toISOString());

    let nudged = 0;

    if (newLeads) {
      for (const lead of newLeads) {
        const hoursSinceContact = (now - new Date(lead.last_msg_at)) / (1000 * 60 * 60);

        if (hoursSinceContact >= 2 && hoursSinceContact < 24) {
          const canSend = await canSendToLead(lead.phone);
          if (!canSend) continue;

          await sendTemplate(lead.phone, 'nudge_trial', [
            lead.name || 'there',
          ]);
          nudged++;
        } else if (hoursSinceContact >= 24) {
          await supabase
            .from('leads')
            .update({ status: 'dropped' })
            .eq('id', lead.id);
        }
      }
    }

    const sevenDaysAgo = new Date(now - NUDGE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gt('last_msg_at', sevenDaysAgo.toISOString())
      .gt('created_at', thirtyDaysAgo.toISOString());

    let reEngaged = 0;

    if (droppedLeads) {
      for (const lead of droppedLeads) {
        const { count } = await supabase
          .from('messages')
          .select('*', { count: 'exact', head: true })
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'reengage_offer');

        if (count && count > 0) continue;

        const canSend = await canSendToLead(lead.phone);
        if (!canSend) continue;

        const hinglish = isHinglishMarket(lead.market);
        const template = hinglish ? 'reengage_offer' : 'reengage_offer_en';

        await sendTemplate(lead.phone, template, [
          lead.name || 'there',
        ]);

        reEngaged++;
      }
    }

    const { data: activeClients } = await supabase
      .from('clients')
      .select('id, phone, name, program, program_started_at')
      .eq('status', 'active');

    let checkinNudged = 0;

    if (activeClients) {
      for (const client of activeClients) {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSinceStart / 7);

        if (currentWeek < 1) continue;

        const { data: checkin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .single();

        if (checkin) continue;

        const dayOfWeek = now.getDay();
        if (dayOfWeek === 1 || dayOfWeek === 2) {
          const canSend = await canSendToLead(client.phone);
          if (!canSend) continue;

          const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;
          await sendTemplate(client.phone, 'checkin_reminder', [
            client.name || 'there',
            checkinUrl,
          ]);
          checkinNudged++;
        }
      }
    }

    return res.status(200).json({
      ok: true,
      nudged,
      reEngaged,
      checkinNudged,
    });
  } catch (err) {
    console.error('[cron/nudge-dropped] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
