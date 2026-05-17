const { supabase } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');
const { detectMarket, isHinglish } = require('../_lib/market');

const SITE = process.env.SITE_URL || 'https://fitnessbymaddy.com';

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();

    // Nudge leads who went silent after 2 hours (Flow A, step 3)
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const { data: silentLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo);

    let nudged = 0;
    for (const lead of (silentLeads || [])) {
      const hoursSinceMsg = (now - new Date(lead.last_msg_at)) / (1000 * 60 * 60);

      // Between 2-24 hours: send trial nudge
      if (hoursSinceMsg >= 2 && hoursSinceMsg < 24) {
        const { data: existingNudge } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'nudge_trial')
          .limit(1)
          .single();

        if (!existingNudge) {
          const market = detectMarket(lead.phone);
          const templateName = isHinglish(market) ? 'nudge_trial_hi' : 'nudge_trial_en';
          const trialLink = `${SITE}/shred.html`;
          await sendTemplate(lead.phone, templateName, [lead.name || 'there', trialLink], lead.name);
          nudged++;
        }
      }

      // After 24 hours: mark as dropped
      if (hoursSinceMsg >= 24) {
        await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
      }
    }

    // Re-engage dropped leads (7-day rule): leads dropped 7+ days ago, max 1 re-engage attempt
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo)
      .gt('last_msg_at', fourteenDaysAgo);

    let reengaged = 0;
    for (const lead of (droppedLeads || [])) {
      const { data: reengageMsg } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 'reengage_7day')
        .limit(1)
        .single();

      if (!reengageMsg) {
        const market = detectMarket(lead.phone);
        const templateName = isHinglish(market) ? 'reengage_7day_hi' : 'reengage_7day_en';
        await sendTemplate(lead.phone, templateName, [lead.name || 'there'], lead.name);
        reengaged++;
      }
    }

    // Nudge active clients with pending check-ins (+24h and +48h)
    const { data: pendingCheckins } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let checkinNudges = 0;
    for (const client of (pendingCheckins || [])) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);
      const dayOfWeek = now.getDay();

      // Only nudge on Monday (1 day after Sunday send) and Tuesday (2 days after)
      if (dayOfWeek !== 1 && dayOfWeek !== 2) continue;

      const { data: checkin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (!checkin) {
        const market = detectMarket(client.phone);
        const checkinUrl = `${SITE}/checkin?c=${client.id}&w=${weekNo}`;
        const templateName = isHinglish(market) ? 'checkin_nudge_hi' : 'checkin_nudge_en';
        await sendTemplate(client.phone, templateName, [client.name || 'there', checkinUrl], client.name);
        checkinNudges++;
      }
    }

    return res.status(200).json({
      ok: true,
      nudged,
      reengaged,
      checkin_nudges: checkinNudges
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
