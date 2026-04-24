const supabase = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');

const NUDGE_WINDOW_HOURS = 2;
const DROP_WINDOW_HOURS = 24;
const RE_ENGAGE_DAYS = 7;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    let nudged = 0;
    let dropped = 0;
    let reengaged = 0;

    const twoHoursAgo = new Date(now.getTime() - NUDGE_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now.getTime() - DROP_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('last_msg_at', twentyFourHoursAgo);

    for (const lead of (newLeads || [])) {
      const { data: messages } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'nudge_trial')
        .limit(1);

      if (messages && messages.length > 0) continue;

      await sendTemplate(lead.phone, 'nudge_trial', {
        name: lead.name || 'there',
        templateParams: [
          lead.name || 'there',
          'https://fitnessbymaddy.com/program-trial.html',
        ],
      });
      nudged++;
    }

    const { data: staleLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twentyFourHoursAgo);

    for (const lead of (staleLeads || [])) {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('id', lead.id);
      dropped++;
    }

    const sevenDaysAgo = new Date(now.getTime() - RE_ENGAGE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(now.getTime() - (RE_ENGAGE_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString();

    const { data: reengageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo)
      .gt('last_msg_at', eightDaysAgo);

    for (const lead of (reengageLeads || [])) {
      const { data: outbound } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'reengage_7d')
        .limit(1);

      if (outbound && outbound.length > 0) continue;

      await sendTemplate(lead.phone, 'reengage_7d', {
        name: lead.name || 'there',
        templateParams: [lead.name || 'there'],
      });
      reengaged++;
    }

    return res.status(200).json({
      success: true,
      nudged,
      dropped,
      reengaged,
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
