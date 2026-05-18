const { getSupabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { isHinglish, detectMarket, maskPhone } = require('../../lib/helpers');

module.exports = async function handler(req, res) {
  try {
    const db = getSupabase();
    const now = new Date();

    // FLOW A step 3: Nudge new leads who haven't replied in 2 hours
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const { data: staleNewLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString());

    let nudged = 0;
    let dropped = 0;

    for (const lead of staleNewLeads || []) {
      // Check if we already sent a nudge
      const { data: outMsgs } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .like('template_name', 'nudge%')
        .limit(1);

      if (outMsgs?.length > 0) continue;

      const market = detectMarket(lead.phone);
      const hinglish = isHinglish(market);
      const templateName = hinglish ? 'nudge_trial_hi' : 'nudge_trial_en';

      try {
        await sendTemplate(lead.phone, templateName, [
          lead.name || 'there',
          '$20',
          'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial'
        ]);
        nudged++;
      } catch (err) {
        console.error(`Nudge failed for ${maskPhone(lead.phone)}:`, err.message);
      }
    }

    // FLOW A step 4: Drop leads with no reply after 24 hours
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const { data: deadLeads } = await db
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lt('created_at', oneDayAgo);

    for (const lead of deadLeads || []) {
      // Check if they replied
      const { data: replies } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gt('sent_at', lead.created_at)
        .limit(1);

      if (!replies || replies.length === 0) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    // Re-engage dropped leads (7-day rule): leads dropped 7 days ago, one last attempt
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const { data: reengageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gt('created_at', eightDaysAgo)
      .lt('created_at', sevenDaysAgo);

    let reengaged = 0;
    for (const lead of reengageLeads || []) {
      const { data: reengage } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .like('template_name', 'reengage%')
        .limit(1);

      if (reengage?.length > 0) continue;

      const market = detectMarket(lead.phone);
      const hinglish = isHinglish(market);
      const templateName = hinglish ? 'reengage_offer_hi' : 'reengage_offer_en';

      try {
        await sendTemplate(lead.phone, templateName, [
          lead.name || 'there'
        ]);
        reengaged++;
      } catch (err) {
        console.error(`Re-engage failed for ${maskPhone(lead.phone)}:`, err.message);
      }
    }

    // Nudge clients who haven't submitted weekly check-in (+24h, +48h)
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let checkinNudges = 0;
    for (const client of activeClients || []) {
      const startDate = new Date(client.program_started_at);
      const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

      const { data: checkin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (checkin?.length > 0) continue;

      // Check how many nudges we've sent this week
      const weekStart = new Date(startDate.getTime() + (weekNo - 1) * 7 * 24 * 60 * 60 * 1000);
      const { data: nudgeMsgs } = await db
        .from('messages')
        .select('id')
        .eq('phone', client.phone)
        .eq('direction', 'out')
        .like('template_name', 'checkin_nudge%')
        .gte('sent_at', weekStart.toISOString());

      if ((nudgeMsgs?.length || 0) >= 2) continue;

      const formUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
      try {
        await sendTemplate(client.phone, 'checkin_nudge', [
          client.name || 'there',
          formUrl
        ]);
        checkinNudges++;
      } catch (err) {
        console.error(`Checkin nudge failed for ${maskPhone(client.phone)}:`, err.message);
      }
    }

    console.log(`Nudge cron: nudged=${nudged} dropped=${dropped} reengaged=${reengaged} checkinNudges=${checkinNudges}`);
    return res.json({ ok: true, nudged, dropped, reengaged, checkinNudges });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
