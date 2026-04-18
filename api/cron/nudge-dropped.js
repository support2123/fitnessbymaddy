const { supabase } = require('../../lib/supabase');
const { sendTemplate, canSendToLead } = require('../../lib/whatsapp');
const { detectMarket, isHinglishMarket } = require('../../lib/utils');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && req.headers['x-vercel-cron'] !== '1') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const { data: reEngageLeads, error } = await supabase
    .from('leads')
    .select('id, phone, name, market, program_interest')
    .eq('status', 'dropped')
    .gte('last_msg_at', fourteenDaysAgo)
    .lte('last_msg_at', sevenDaysAgo);

  if (error) {
    console.error('Nudge query error:', error);
    return res.status(500).json({ error: 'Failed to query leads' });
  }

  const results = { sent: 0, skipped: 0 };

  for (const lead of (reEngageLeads || [])) {
    const allowed = await canSendToLead(lead.phone);
    if (!allowed) {
      results.skipped++;
      continue;
    }

    const market = lead.market || detectMarket(lead.phone);
    const templateName = isHinglishMarket(market) ? 'nudge_trial_hi' : 'nudge_trial';

    await sendTemplate(lead.phone, templateName, [
      lead.name || 'there',
      'https://www.fitnessbymaddy.com/shred.html',
    ]);

    await supabase
      .from('leads')
      .update({ status: 'new', last_msg_at: new Date().toISOString() })
      .eq('id', lead.id);

    results.sent++;
  }

  const { data: missedCheckins } = await supabase
    .from('clients')
    .select(`
      id, phone, name, program, program_started_at,
      checkins(week_no, form_submitted_at)
    `)
    .eq('status', 'active');

  let escalations = 0;

  for (const client of (missedCheckins || [])) {
    const startDate = new Date(client.program_started_at);
    const now = new Date();
    const currentWeek = Math.ceil((now - startDate) / (1000 * 60 * 60 * 24 * 7));

    const submittedWeeks = new Set((client.checkins || []).map(c => c.week_no));
    let consecutiveMissed = 0;

    for (let w = currentWeek; w >= Math.max(1, currentWeek - 2); w--) {
      if (!submittedWeeks.has(w)) consecutiveMissed++;
      else break;
    }

    if (consecutiveMissed >= 2) {
      await sendTemplate('917082478374', 'escalation_alert', [
        client.name || client.phone,
        `2 consecutive missed check-ins (current week: ${currentWeek})`,
      ]);
      escalations++;
    }
  }

  return res.status(200).json({ success: true, ...results, escalations });
};
