const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, detectMarket } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    // Nudge new leads who haven't replied (2hr mark)
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Mark stale leads as dropped (no reply in 24hrs)
    const { data: staleLeads } = await db
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lt('created_at', twentyFourHoursAgo);

    if (staleLeads) {
      for (const lead of staleLeads) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
      }
    }

    // Send 2hr nudge to new leads
    const { data: nudgeLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', twentyFourHoursAgo);

    let nudged = 0;
    if (nudgeLeads) {
      for (const lead of nudgeLeads) {
        const { data: outbound } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'nudge_trial')
          .limit(1);

        if (outbound && outbound.length > 0) continue;

        const market = detectMarket(lead.phone);
        const templateName = market === 'IN' ? 'nudge_trial' : 'nudge_trial_en';
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

    // Re-engage dropped leads (7-day rule: only those dropped 7+ days ago, one attempt)
    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo);

    let reengaged = 0;
    if (droppedLeads) {
      for (const lead of droppedLeads) {
        const { data: reengage } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'reengage_7day')
          .limit(1);

        if (reengage && reengage.length > 0) continue;

        await sendTemplate(lead.phone, 'reengage_7day', {
          name: lead.name || 'there',
          templateParams: [lead.name || 'there']
        });
        reengaged++;
      }
    }

    return res.json({
      ok: true,
      stale_dropped: staleLeads?.length || 0,
      nudged,
      reengaged
    });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
