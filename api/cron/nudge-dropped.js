const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, maskPhone, detectMarket, isHinglish } = require('../../lib/whatsapp');
const { jsonResponse, errorResponse } = require('../../lib/utils');

module.exports = async function handler(req) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return errorResponse('Unauthorized', 401);
  }

  const db = getSupabase();
  const now = new Date();
  const results = { nudged_2hr: 0, dropped_24hr: 0, re_engaged: 0 };

  // 1. Nudge leads who haven't replied in 2 hours (status=new)
  const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
  const { data: staleNewLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('last_msg_at', twoHoursAgo);

  if (staleNewLeads) {
    for (const lead of staleNewLeads) {
      // Check if we already sent a nudge (avoid double-nudging)
      const { data: existingNudge } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 'nudge_trial')
        .limit(1);

      if (!existingNudge || existingNudge.length === 0) {
        const market = detectMarket(lead.phone);
        const templateName = isHinglish(market) ? 'nudge_trial_hi' : 'nudge_trial';
        await sendTemplate(lead.phone, templateName, {
          name: lead.name || 'there',
          templateParams: ['https://fitnessbymaddy.com/program-trial.html']
        });
        results.nudged_2hr++;
      }
    }
  }

  // 2. Mark leads as dropped if no reply in 24 hours
  const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const { data: deadLeads } = await db
    .from('leads')
    .select('id')
    .eq('status', 'new')
    .lt('last_msg_at', twentyFourHoursAgo);

  if (deadLeads) {
    for (const lead of deadLeads) {
      await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
      results.dropped_24hr++;
    }
  }

  // 3. Re-engage dropped leads (dropped within last 7 days, not already re-engaged)
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: reEngageLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'dropped')
    .gte('last_msg_at', sevenDaysAgo);

  if (reEngageLeads) {
    for (const lead of reEngageLeads) {
      // Check if re-engagement already sent
      const { data: existing } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 're_engage')
        .limit(1);

      if (!existing || existing.length === 0) {
        const market = detectMarket(lead.phone);
        const templateName = isHinglish(market) ? 're_engage_hi' : 're_engage';
        await sendTemplate(lead.phone, templateName, {
          name: lead.name || 'there'
        });
        results.re_engaged++;
      }
    }
  }

  // 4. Nudge active clients who haven't submitted check-in (+24hrs, +48hrs)
  const { data: activeClients } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active');

  let checkinNudges = 0;
  if (activeClients) {
    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

      const { data: checkin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (!checkin) {
        // Check when last Sunday was (check-in day)
        const daysSinceSunday = now.getDay();
        if (daysSinceSunday >= 1 && daysSinceSunday <= 2) {
          const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
          const market = detectMarket(client.phone);
          const templateName = isHinglish(market) ? 'checkin_nudge_hi' : 'checkin_nudge';
          await sendTemplate(client.phone, templateName, {
            isClient: true,
            name: client.name || 'there',
            templateParams: [String(weekNo), checkinUrl]
          });
          checkinNudges++;
        }
      }
    }
  }

  results.checkin_nudges = checkinNudges;
  return jsonResponse({ success: true, ...results });
};
