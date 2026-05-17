const { supabase } = require('../lib/supabase');
const { sendWhatsApp, detectMarket } = require('../lib/whatsapp');

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = Date.now();
    let nudged = 0;
    let dropped = 0;

    const { data: newLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new');

    if (newLeads) {
      for (const lead of newLeads) {
        const lastMsg = new Date(lead.last_msg_at || lead.created_at).getTime();
        const elapsed = now - lastMsg;

        if (elapsed >= TWENTY_FOUR_HOURS_MS) {
          await supabase
            .from('leads')
            .update({ status: 'dropped' })
            .eq('id', lead.id);
          dropped++;
        } else if (elapsed >= TWO_HOURS_MS) {
          const { data: msgs } = await supabase
            .from('messages')
            .select('template_name')
            .eq('phone', lead.phone)
            .eq('direction', 'out')
            .eq('template_name', 'nudge_trial');

          if (!msgs || msgs.length === 0) {
            await sendWhatsApp(lead.phone, 'nudge_trial', {
              name: lead.name || 'there',
              templateParams: [
                lead.name || 'there',
                'https://fitnessbymaddy.com/program-trial.html'
              ]
            }, true);
            nudged++;
          }
        }
      }
    }

    const sevenDaysAgo = new Date(now - SEVEN_DAYS_MS).toISOString();
    const { data: reEngageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gt('created_at', sevenDaysAgo);

    let reEngaged = 0;
    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        const { data: reEngageMsgs } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'reengage_7day');

        if (!reEngageMsgs || reEngageMsgs.length === 0) {
          const daysSinceDropped = Math.floor((now - new Date(lead.last_msg_at).getTime()) / (24 * 60 * 60 * 1000));
          if (daysSinceDropped >= 7) {
            await sendWhatsApp(lead.phone, 'reengage_7day', {
              name: lead.name || 'there',
              templateParams: [lead.name || 'there']
            }, true);
            reEngaged++;
          }
        }
      }
    }

    return res.status(200).json({ success: true, nudged, dropped, reEngaged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
