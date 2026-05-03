const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { isHinglish, json } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return json(res, { error: 'GET only' }, 405);

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return json(res, { error: 'unauthorized' }, 401);
  }

  try {
    const sb = getSupabase();

    const now = new Date();

    // FLOW A step 3: Nudge leads that haven't replied in 2 hours
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const { data: staleNewLeads } = await sb
      .from('leads')
      .select('id, phone, name, market, created_at')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo);

    let nudged = 0;
    if (staleNewLeads) {
      for (const lead of staleNewLeads) {
        const { data: replies } = await sb
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .gt('sent_at', lead.created_at)
          .limit(1);

        if (replies && replies.length > 0) continue;

        const { data: nudges } = await sb
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'nudge_trial')
          .limit(1);

        if (nudges && nudges.length > 0) continue;

        const trialUrl = 'https://www.fitnessbymaddy.com/program-trial.html';
        if (isHinglish(lead.market)) {
          await sendTemplate(lead.phone, 'nudge_trial', [
            lead.name || 'there',
            trialUrl
          ]);
        } else {
          await sendTemplate(lead.phone, 'nudge_trial_en', [
            lead.name || 'there',
            trialUrl
          ]);
        }
        nudged++;
      }
    }

    // FLOW A step 4: Drop leads that haven't replied in 24 hours
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const { data: deadLeads } = await sb
      .from('leads')
      .select('id, phone, created_at')
      .eq('status', 'new')
      .lt('created_at', twentyFourHoursAgo);

    let dropped = 0;
    if (deadLeads) {
      for (const lead of deadLeads) {
        const { data: replies } = await sb
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .gt('sent_at', lead.created_at)
          .limit(1);

        if (replies && replies.length > 0) continue;

        await sb.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    // Re-engage dropped leads (7-day rule): leads dropped 7+ days ago, re-nudge once
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data: reEngageLeads } = await sb
      .from('leads')
      .select('id, phone, name, market, last_msg_at')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo)
      .gt('last_msg_at', fourteenDaysAgo);

    let reengaged = 0;
    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        const { data: reengageAttempts } = await sb
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'reengage_7day')
          .limit(1);

        if (reengageAttempts && reengageAttempts.length > 0) continue;

        await sendTemplate(lead.phone, 'reengage_7day', [
          lead.name || 'there'
        ]);
        reengaged++;
      }
    }

    return json(res, { ok: true, nudged, dropped, reengaged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return json(res, { error: 'internal' }, 500);
  }
};
