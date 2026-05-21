const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;

  if (!isCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeadsNudge } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .eq('opted_out', false)
      .lte('last_msg_at', twoHoursAgo)
      .gte('created_at', twentyFourHoursAgo);

    let nudged = 0;
    let dropped = 0;

    for (const lead of (newLeadsNudge || [])) {
      const market = detectMarket(lead.phone);
      const hinglish = isHinglish(market);

      await sendWhatsApp({
        phone: lead.phone,
        templateName: 'nudge_trial',
        bodyValues: hinglish
          ? [lead.name || 'there', 'Ek baar try karo — $20 mein Zoom trial session. Link: https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial']
          : [lead.name || 'there', 'Try a $20 Zoom trial session — zero commitment, real coaching. Link: https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial'],
      });
      nudged++;
    }

    const { data: staleLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .eq('opted_out', false)
      .lte('last_msg_at', twentyFourHoursAgo);

    for (const lead of (staleLeads || [])) {
      await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
      dropped++;
    }

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .eq('opted_out', false)
      .gte('created_at', sevenDaysAgo)
      .lte('last_msg_at', new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString());

    let reengaged = 0;

    for (const lead of (droppedLeads || [])) {
      const { data: recentMsg } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'reengage_dropped')
        .limit(1);

      if (recentMsg?.length > 0) continue;

      const market = detectMarket(lead.phone);
      const hinglish = isHinglish(market);

      await sendWhatsApp({
        phone: lead.phone,
        templateName: 'reengage_dropped',
        bodyValues: hinglish
          ? [lead.name || 'there', 'Maddy ka $20 Zoom trial abhi bhi available hai. Koi commitment nahi — sirf ek session try karo!']
          : [lead.name || 'there', 'Maddy\'s $20 Zoom trial is still available. No commitment — just one session to see if it\'s right for you!'],
      });
      reengaged++;
    }

    return res.status(200).json({
      success: true,
      nudged,
      dropped,
      reengaged,
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
