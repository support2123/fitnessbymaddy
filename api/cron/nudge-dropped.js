const { getSupabase } = require('../_lib/supabase');
const { sendTemplate, canSendMessage } = require('../_lib/whatsapp');
const { isHinglish } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('last_msg_at', twoHoursAgo)
      .gte('last_msg_at', twentyFourHoursAgo);

    let nudged = 0;

    if (newLeads) {
      for (const lead of newLeads) {
        const allowed = await canSendMessage(lead.phone);
        if (!allowed) continue;

        const template = isHinglish(lead.market) ? 'nudge_trial_hi' : 'nudge_trial_en';
        await sendTemplate(lead.phone, template, [lead.name || 'there']);
        nudged++;
      }
    }

    const { data: staleLeads } = await db
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lte('last_msg_at', twentyFourHoursAgo);

    let dropped = 0;

    if (staleLeads) {
      for (const lead of staleLeads) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    const { data: reEngageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', sevenDaysAgo);

    let reEngaged = 0;

    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        const { count } = await db
          .from('messages')
          .select('id', { count: 'exact' })
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'win_back');

        if (count && count >= 1) continue;

        const allowed = await canSendMessage(lead.phone);
        if (!allowed) continue;

        const template = isHinglish(lead.market) ? 'win_back_hi' : 'win_back_en';
        await sendTemplate(lead.phone, template, [lead.name || 'there']);
        reEngaged++;
      }
    }

    const { data: activeClients } = await db
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    let missedCheckinAlerts = 0;

    if (activeClients) {
      for (const client of activeClients) {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSinceStart / 7);

        if (currentWeek < 3) continue;

        const { data: recentCheckins } = await db
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .gte('week_no', currentWeek - 2);

        if (!recentCheckins || recentCheckins.length === 0) {
          const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';
          await sendTemplate(MADDY_PHONE, 'missed_checkins_alert', [
            client.name || 'A client',
            '2',
          ]);
          missedCheckinAlerts++;
        }
      }
    }

    return res.json({ nudged, dropped, reEngaged, missedCheckinAlerts });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
