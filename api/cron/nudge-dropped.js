const { supabase } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');
const { isHinglish, detectMarket } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();

    // FLOW A step 3: Nudge new leads who haven't replied in 2 hrs
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const { data: staleNewLeads } = await supabase
      .from('leads')
      .select('id, phone, market, created_at')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', twentyFourHoursAgo);

    let nudged = 0;

    for (const lead of staleNewLeads || []) {
      const hinglish = isHinglish(lead.market || detectMarket(lead.phone));
      const params = hinglish
        ? ['Hey! 👋 Maddy ke $20 trial class try karo — no commitment. Link: https://fitnessbymaddy.com/trial']
        : ['Hey! 👋 Try Maddy\'s $20 trial class — no commitment. Link: https://fitnessbymaddy.com/trial'];

      await sendTemplate(lead.phone, 'nudge_trial', params);
      nudged++;
    }

    // FLOW A step 4: Drop leads with no reply after 24 hrs
    const { data: deadLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('created_at', twentyFourHoursAgo);

    let dropped = 0;
    for (const lead of deadLeads || []) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
      dropped++;
    }

    // Re-engage dropped leads (7-day rule): leads dropped 7+ days ago, not yet re-engaged
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reEngageLeads } = await supabase
      .from('leads')
      .select('id, phone, name, market')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo)
      .gt('last_msg_at', eightDaysAgo);

    let reEngaged = 0;
    for (const lead of reEngageLeads || []) {
      const hinglish = isHinglish(lead.market || detectMarket(lead.phone));
      const params = hinglish
        ? [lead.name || 'there', 'Abhi bhi goal achieve karna hai? Maddy ka trial class try karo — sirf $20! 🔥']
        : [lead.name || 'there', 'Still thinking about your fitness goals? Try Maddy\'s trial class — just $20! 🔥'];

      await sendTemplate(lead.phone, 'reengage_7day', params);
      reEngaged++;
    }

    // Nudge active clients who haven't submitted check-in (+24h, +48h)
    const { data: pendingClients } = await supabase
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    let clientNudged = 0;
    for (const client of pendingClients || []) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);
      if (weekNo < 1) continue;

      const { data: checkin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (checkin) continue;

      const dayOfWeek = now.getDay();
      if (dayOfWeek === 1 || dayOfWeek === 2) {
        const market = detectMarket(client.phone);
        const hinglish = isHinglish(market);
        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

        const params = hinglish
          ? [client.name || 'there', `Check-in abhi tak nahi bhara! 📋 Yaha se bharo: ${checkinUrl}`]
          : [client.name || 'there', `Don't forget your check-in! 📋 Fill it here: ${checkinUrl}`];

        await sendTemplate(client.phone, 'checkin_nudge', params);
        clientNudged++;
      }
    }

    return res.status(200).json({
      ok: true,
      nudged,
      dropped,
      reEngaged,
      clientNudged,
    });
  } catch (err) {
    console.error('nudge-dropped cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
