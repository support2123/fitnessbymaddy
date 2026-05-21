const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization;
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;
  if (!isVercelCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    const { data: staleLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('created_at', sevenDaysAgo);

    let nudged = 0;

    for (const lead of (staleLeads || [])) {
      const hoursSinceMsg = (Date.now() - new Date(lead.last_msg_at).getTime()) / (60 * 60 * 1000);

      let template;
      if (hoursSinceMsg >= 24) {
        await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        continue;
      }

      if (hoursSinceMsg >= 2) {
        template = isHinglish(lead.market) ? 'nudge_trial_hi' : 'nudge_trial_en';
        const trialUrl = 'https://www.fitnessbymaddy.com/shred.html';
        const result = await sendTemplate(lead.phone, template, [
          lead.name || 'there',
          trialUrl,
        ]);
        if (result.ok) nudged++;
      }
    }

    const { data: qualifiedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'qualified')
      .lt('last_msg_at', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
      .gt('created_at', sevenDaysAgo);

    for (const lead of (qualifiedLeads || [])) {
      const template = isHinglish(lead.market) ? 'qualified_followup_hi' : 'qualified_followup_en';
      const result = await sendTemplate(lead.phone, template, [
        lead.name || 'there',
        lead.program_interest || 'program',
      ]);
      if (result.ok) nudged++;
    }

    return res.json({ message: 'Nudge cycle complete', nudged });
  } catch (err) {
    console.error('nudge-dropped cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
