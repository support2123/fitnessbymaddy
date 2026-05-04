const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabase = getSupabase();
  const now = new Date();

  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const { data: newLeadsNoReply } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('created_at', twoHoursAgo.toISOString())
    .gt('created_at', new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString());

  const results = [];

  if (newLeadsNoReply) {
    for (const lead of newLeadsNoReply) {
      const { data: msgs } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'nudge_trial');

      if (msgs && msgs.length > 0) continue;

      await sendTemplate(lead.phone, 'nudge_trial', {
        name: lead.name || 'there',
        templateParams: [lead.name || 'there', 'https://fitnessbymaddy.com/program-trial.html']
      });

      results.push({ phone: lead.phone, action: 'nudge_sent' });
    }
  }

  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const { data: staleLeads } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('created_at', twentyFourHoursAgo.toISOString());

  if (staleLeads) {
    for (const lead of staleLeads) {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('id', lead.id);
      results.push({ phone: lead.phone, action: 'marked_dropped' });
    }
  }

  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const { data: reEngageLeads } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'dropped')
    .lt('last_msg_at', sevenDaysAgo.toISOString())
    .gt('last_msg_at', fourteenDaysAgo.toISOString());

  if (reEngageLeads) {
    for (const lead of reEngageLeads) {
      const { data: reengaged } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 'reengage_7day');

      if (reengaged && reengaged.length > 0) continue;

      await sendTemplate(lead.phone, 'reengage_7day', {
        name: lead.name || 'there',
        templateParams: [lead.name || 'there']
      });

      results.push({ phone: lead.phone, action: 'reengage_sent' });
    }
  }

  return res.status(200).json({ processed: results.length, results });
};
