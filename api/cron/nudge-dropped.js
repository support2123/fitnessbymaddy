const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  const cronSecret = req.headers['x-vercel-cron'];
  if (!cronSecret && (!authHeader || authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeadsNeedingNudge } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo)
      .gte('created_at', twentyFourHoursAgo);

    let nudged = 0;

    for (const lead of (newLeadsNeedingNudge || [])) {
      const { data: msgs } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'nudge_trial')
        .limit(1);

      if (msgs && msgs.length > 0) continue;

      const isHinglish = lead.market === 'IN';

      await sendWhatsApp({
        phone: lead.phone,
        templateName: 'nudge_trial',
        params: [lead.name || 'there'],
        body: isHinglish
          ? `Hey ${lead.name || 'there'}! Abhi tak decide nahi kiya? $20 mein Maddy ke saath ek trial Zoom session try karo. Koi commitment nahi.\n\nhttps://www.fitnessbymaddy.com/program-trial.html`
          : `Hey ${lead.name || 'there'}! Still deciding? Try a $20 trial Zoom session with Maddy. No commitment required.\n\nhttps://www.fitnessbymaddy.com/program-trial.html`,
      });

      nudged++;
    }

    const { data: staleLeads } = await db
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lte('created_at', twentyFourHoursAgo);

    if (staleLeads && staleLeads.length > 0) {
      const staleIds = staleLeads.map(l => l.id);
      await db.from('leads').update({ status: 'dropped' }).in('id', staleIds);
    }

    const { data: reEngageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', sevenDaysAgo);

    let reEngaged = 0;

    for (const lead of (reEngageLeads || [])) {
      const { data: recentOut } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'reengage_7day')
        .limit(1);

      if (recentOut && recentOut.length > 0) continue;

      await sendWhatsApp({
        phone: lead.phone,
        templateName: 'reengage_7day',
        params: [lead.name || 'there'],
        body: `Hey ${lead.name || 'there'}, just checking in! Maddy's programs are filling up. Ready to start your transformation?`,
      });

      reEngaged++;
    }

    return res.status(200).json({
      action: 'nudge_complete',
      nudged,
      stale_dropped: staleLeads?.length || 0,
      re_engaged: reEngaged,
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
