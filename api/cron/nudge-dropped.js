const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');

const NUDGE_WINDOW_DAYS = 7;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const now = Date.now();
    const results = [];

    const { data: newLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', new Date(now - TWO_HOURS_MS).toISOString())
      .gt('created_at', new Date(now - TWENTY_FOUR_HOURS_MS).toISOString());

    if (newLeads) {
      for (const lead of newLeads) {
        const { data: replies } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .gt('sent_at', lead.created_at)
          .limit(1);

        if (!replies || replies.length === 0) {
          const { data: nudges } = await supabase
            .from('messages')
            .select('id')
            .eq('phone', lead.phone)
            .eq('template_name', 'nudge_trial')
            .limit(1);

          if (!nudges || nudges.length === 0) {
            await sendTemplate(lead.phone, 'nudge_trial', {
              name: lead.name || 'there',
              templateParams: [lead.name || 'there'],
            });
            results.push({ phone: lead.phone, action: 'nudged_2hr' });
          }
        }
      }
    }

    const { data: staleLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', new Date(now - TWENTY_FOUR_HOURS_MS).toISOString());

    if (staleLeads) {
      for (const lead of staleLeads) {
        const { data: replies } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .gt('sent_at', lead.created_at)
          .limit(1);

        if (!replies || replies.length === 0) {
          await supabase
            .from('leads')
            .update({ status: 'dropped' })
            .eq('id', lead.id);
          results.push({ phone: lead.phone, action: 'dropped_24hr' });
        }
      }
    }

    const sevenDaysAgo = new Date(now - NUDGE_WINDOW_DAYS * 86400000).toISOString();
    const { data: reEngageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gt('last_msg_at', sevenDaysAgo);

    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        const { data: recentNudge } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'reengage_7day')
          .limit(1);

        if (!recentNudge || recentNudge.length === 0) {
          await sendTemplate(lead.phone, 'reengage_7day', {
            name: lead.name || 'there',
            templateParams: [lead.name || 'there'],
          });
          results.push({ phone: lead.phone, action: 'reengaged_7day' });
        }
      }
    }

    return res.status(200).json({ processed: results.length, results });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
