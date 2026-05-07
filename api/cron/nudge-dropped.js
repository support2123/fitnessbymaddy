const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const now = new Date();
    let nudged2hr = 0;
    let nudged24hr = 0;
    let dropped = 0;

    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo)
      .gte('created_at', twentyFourHoursAgo);

    if (newLeads) {
      for (const lead of newLeads) {
        const { data: msgs } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .ilike('template_name', '%nudge%')
          .limit(1);

        if (msgs && msgs.length > 0) continue;

        const template = isHinglish(lead.market) ? 'nudge_trial' : 'nudge_trial_en';
        await sendTemplate(lead.phone, template, [
          'https://fitnessbymaddy.com/program-trial.html',
        ]);
        nudged2hr++;
      }
    }

    const { data: staleLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twentyFourHoursAgo)
      .gte('created_at', sevenDaysAgo);

    if (staleLeads) {
      for (const lead of staleLeads) {
        await supabase
          .from('leads')
          .update({ status: 'dropped' })
          .eq('id', lead.id);
        dropped++;
      }
    }

    const { data: reEngageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', sevenDaysAgo);

    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        const { data: recentOut } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .gte('sent_at', sevenDaysAgo)
          .ilike('template_name', '%reengage%')
          .limit(1);

        if (recentOut && recentOut.length > 0) continue;

        const template = isHinglish(lead.market) ? 'reengage_offer' : 'reengage_offer_en';
        await sendTemplate(lead.phone, template, [lead.name || 'there']);
      }
    }

    const { data: pendingCheckins } = await supabase
      .from('checkins')
      .select('*, clients(phone, name, leads(market))')
      .is('form_submitted_at', null)
      .gte('created_at', twoHoursAgo);

    if (pendingCheckins) {
      for (const checkin of pendingCheckins) {
        if (!checkin.clients) continue;
        const createdAt = new Date(checkin.created_at);
        const hoursSince = (now - createdAt) / (1000 * 60 * 60);

        if (hoursSince >= 24 && hoursSince < 48) {
          const market = checkin.clients.leads?.market || 'IN';
          const template = isHinglish(market) ? 'checkin_reminder' : 'checkin_reminder_en';
          const url = `https://fitnessbymaddy.com/checkin?c=${checkin.client_id}&w=${checkin.week_no}`;
          await sendTemplate(checkin.clients.phone, template, [
            checkin.clients.name || 'there',
            url,
          ]);
        }
      }
    }

    return res.status(200).json({
      success: true,
      nudged2hr,
      dropped,
      nudged24hr,
    });
  } catch (err) {
    console.error('[cron/nudge-dropped]', err.message);
    return res.status(500).json({ error: 'Nudge cron failed' });
  }
};
