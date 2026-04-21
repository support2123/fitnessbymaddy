const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const { data: staleLeads } = await db
    .from('leads')
    .select('*')
    .in('status', ['new', 'qualified'])
    .lte('last_msg_at', sevenDaysAgo)
    .gte('last_msg_at', fourteenDaysAgo);

  if (!staleLeads?.length) {
    return res.status(200).json({ message: 'No leads to nudge', count: 0 });
  }

  let nudged = 0;

  for (const lead of staleLeads) {
    const { data: recentMessages } = await db
      .from('messages')
      .select('id')
      .eq('phone', lead.phone)
      .eq('direction', 'out')
      .eq('template_name', 'reengagement_7day')
      .gte('sent_at', fourteenDaysAgo)
      .limit(1);

    if (recentMessages?.length > 0) continue;

    try {
      await sendWhatsApp({
        phone: lead.phone,
        templateName: 'reengagement_7day',
        params: [lead.name || 'there'],
      });
      nudged++;
    } catch (e) {
      console.error(`[NUDGE] Failed for lead ${lead.id}:`, e.message);
    }
  }

  const { data: twoDayLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lte('created_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

  for (const lead of (twoDayLeads || [])) {
    const { data: nudged_already } = await db
      .from('messages')
      .select('id')
      .eq('phone', lead.phone)
      .eq('template_name', 'nudge_trial')
      .limit(1);

    if (nudged_already?.length > 0) continue;

    await sendWhatsApp({
      phone: lead.phone,
      templateName: 'nudge_trial',
      params: [lead.name || 'there', 'https://fitnessbymaddy.com/program-trial.html'],
    });
  }

  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  await db
    .from('leads')
    .update({ status: 'dropped' })
    .eq('status', 'new')
    .lte('created_at', twentyFourHoursAgo)
    .is('program_interest', null);

  return res.status(200).json({ message: 'Nudge cycle complete', nudged });
};
