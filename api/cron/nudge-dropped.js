const { getSupabase } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');
const { isHinglish, detectMarket } = require('../_lib/market');

const NUDGE_WINDOW_DAYS = 7;
const TRIAL_URL = 'https://www.fitnessbymaddy.com/shred.html';

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sb = getSupabase();
    const now = new Date();

    const { data: newLeads } = await sb
      .from('leads')
      .select('id, phone, name, market, created_at, last_msg_at')
      .eq('status', 'new')
      .lt('last_msg_at', new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString())
      .gt('created_at', new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString());

    let nudged2hr = 0;
    if (newLeads) {
      for (const lead of newLeads) {
        const { data: msgs } = await sb
          .from('messages')
          .select('template_name')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'nudge_trial');

        if (msgs && msgs.length > 0) continue;

        const hinglish = isHinglish(lead.market || detectMarket(lead.phone));
        const msg = hinglish
          ? [`Hey! Maddy ka $20 trial try karo — ek Zoom session mein clear hoga ki kya sahi rahega: ${TRIAL_URL}`]
          : [`Hey! Try Maddy's $20 trial — one Zoom session to figure out the best path for you: ${TRIAL_URL}`];

        await sendTemplate(lead.phone, 'nudge_trial', msg);
        nudged2hr++;
      }
    }

    const { data: staleLeads } = await sb
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lt('last_msg_at', new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString());

    let dropped = 0;
    if (staleLeads) {
      for (const lead of staleLeads) {
        await sb.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    const sevenDaysAgo = new Date(now.getTime() - NUDGE_WINDOW_DAYS * 86400000);
    const { data: reEngageLeads } = await sb
      .from('leads')
      .select('id, phone, name, market, program_interest')
      .eq('status', 'qualified')
      .gt('last_msg_at', sevenDaysAgo.toISOString());

    let reEngaged = 0;
    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        const { data: client } = await sb
          .from('clients')
          .select('id')
          .eq('phone', lead.phone)
          .single();

        if (client) continue;

        const { data: nudges } = await sb
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'qualified_followup')
          .gt('sent_at', sevenDaysAgo.toISOString());

        if (nudges && nudges.length > 0) continue;

        const hinglish = isHinglish(lead.market || detectMarket(lead.phone));
        const msg = hinglish
          ? [`Hi ${lead.name || 'there'}! Abhi bhi interested ho? Maddy ki team ready hai tumhari journey start karne ke liye 💪`]
          : [`Hi ${lead.name || 'there'}! Still interested? Maddy's team is ready to kickstart your journey 💪`];

        await sendTemplate(lead.phone, 'qualified_followup', msg);
        reEngaged++;
      }
    }

    return res.status(200).json({ nudged2hr, dropped, reEngaged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
