const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, detectMarket } = require('../../lib/whatsapp');
const { jsonResponse } = require('../../lib/utils');

module.exports = async function handler(req) {
  if (req.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    const db = getSupabase();

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: stalledLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo)
      .gte('created_at', twentyFourHoursAgo);

    let nudged = 0;
    let dropped = 0;

    if (stalledLeads?.length) {
      for (const lead of stalledLeads) {
        const { count } = await db
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('phone', lead.phone)
          .eq('template_name', 'nudge_trial');

        if (!count || count === 0) {
          const market = lead.market || detectMarket(lead.phone);
          const params = market === 'IN'
            ? ['Ek baar try karo! $20 mein Maddy ke saath Zoom trial session book karo. Limited slots!']
            : ['Give it a try! Book a $20 Zoom trial session with Maddy. Limited slots!'];

          await sendTemplate(lead.phone, 'nudge_trial', params);
          nudged++;
        }
      }
    }

    const { data: expiredLeads } = await db
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('created_at', twentyFourHoursAgo);

    if (expiredLeads?.length) {
      const ids = expiredLeads.map(l => l.id);
      await db.from('leads').update({ status: 'dropped' }).in('id', ids);
      dropped = ids.length;
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: reEngageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('created_at', sevenDaysAgo);

    let reEngaged = 0;

    if (reEngageLeads?.length) {
      for (const lead of reEngageLeads) {
        const { count } = await db
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('phone', lead.phone)
          .eq('template_name', 're_engage');

        if (!count || count === 0) {
          await sendTemplate(lead.phone, 're_engage', [
            lead.name || 'there'
          ]);
          reEngaged++;
        }
      }
    }

    return jsonResponse({ ok: true, nudged, dropped, reEngaged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return jsonResponse({ error: 'Internal error' }, 500);
  }
};
