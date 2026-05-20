const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { maskPhone } = require('../../lib/market');

const NUDGE_WINDOW_DAYS = 7;
const NUDGE_COOLDOWN_HOURS = 48;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - NUDGE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const cooldownCutoff = new Date(Date.now() - NUDGE_COOLDOWN_HOURS * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .gte('created_at', sevenDaysAgo)
      .lte('last_msg_at', cooldownCutoff);

    let nudged = 0;

    for (const lead of newLeads || []) {
      try {
        const { count } = await supabase
          .from('messages')
          .select('*', { count: 'exact', head: true })
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'nudge_trial');

        if (count && count >= 2) continue;

        await sendTemplate(lead.phone, 'nudge_trial', [
          lead.name || 'there',
          'https://fitnessbymaddy.com/intake.html',
        ]);

        await supabase.from('leads').update({
          last_msg_at: new Date().toISOString(),
        }).eq('id', lead.id);

        nudged++;
        console.log(`Nudged: ${maskPhone(lead.phone)}`);
      } catch (leadErr) {
        console.error(`Nudge error for lead ${lead.id}:`, leadErr.message);
      }
    }

    const tooOld = new Date(Date.now() - NUDGE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    await supabase
      .from('leads')
      .update({ status: 'dropped' })
      .eq('status', 'new')
      .lt('created_at', tooOld);

    console.log(`Nudge cron: nudged=${nudged}`);
    return res.status(200).json({ status: 'completed', nudged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
