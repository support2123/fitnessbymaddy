const { getSupabase } = require('../_lib/supabase');
const { sendTemplate, detectMarket } = require('../_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getSupabase();

    const now = new Date();
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: staleNewLeads } = await db
      .from('leads')
      .select('id, phone, name, last_msg_at, market')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('last_msg_at', twentyFourHoursAgo);

    let nudged = 0;

    if (staleNewLeads) {
      for (const lead of staleNewLeads) {
        const market = lead.market || detectMarket(lead.phone);
        const templateName = market === 'IN' ? 'nudge_trial_hinglish' : 'nudge_trial_en';

        await sendTemplate(lead.phone, templateName, {
          name: lead.name || 'there',
          templateParams: [
            lead.name || 'there',
            'https://fitnessbymaddy.com/program-trial.html'
          ]
        });
        nudged++;
      }
    }

    const { data: expiredLeads } = await db
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('last_msg_at', twentyFourHoursAgo);

    let dropped = 0;
    if (expiredLeads) {
      for (const lead of expiredLeads) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    const { data: reEngageLeads } = await db
      .from('leads')
      .select('id, phone, name, market')
      .eq('status', 'dropped')
      .gt('last_msg_at', sevenDaysAgo);

    let reEngaged = 0;
    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        const { data: msgCount } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'reengage_offer')
          .limit(1);

        if (msgCount && msgCount.length > 0) continue;

        const market = lead.market || detectMarket(lead.phone);
        const templateName = market === 'IN' ? 'reengage_offer_hinglish' : 'reengage_offer_en';

        await sendTemplate(lead.phone, templateName, {
          name: lead.name || 'there',
          templateParams: [lead.name || 'there']
        });
        reEngaged++;
      }
    }

    return res.status(200).json({ ok: true, nudged, dropped, reEngaged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
