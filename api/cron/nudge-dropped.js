const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = getSupabase();

  // Find leads that went silent 2 hours after welcome (no reply yet)
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Nudge leads that haven't replied in 2+ hours (send trial link)
  const { data: silentLeads } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('created_at', twoHoursAgo)
    .gt('created_at', twentyFourHoursAgo);

  let nudged = 0;
  let dropped = 0;

  for (const lead of (silentLeads || [])) {
    // Check if we already nudged (check messages)
    const { data: nudges } = await supabase
      .from('messages')
      .select('id')
      .eq('phone', lead.phone)
      .eq('template_name', 'nudge_trial')
      .limit(1);

    if (nudges && nudges.length > 0) {
      // Already nudged — if created > 24hrs ago, drop
      if (new Date(lead.created_at) < new Date(twentyFourHoursAgo)) {
        await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
      continue;
    }

    // Send nudge
    await sendWhatsApp(lead.phone, 'nudge_trial', {
      name: lead.name || 'there',
      templateParams: [lead.name || 'there', 'https://www.fitnessbymaddy.com/program-trial.html']
    }).catch(() => {});

    await supabase.from('messages').insert({
      phone: lead.phone,
      direction: 'out',
      body: 'Trial nudge sent',
      template_name: 'nudge_trial',
      sent_at: new Date().toISOString(),
      status: 'sent'
    });

    nudged++;
  }

  // Re-engage dropped leads (7-day rule: one final attempt)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();

  const { data: droppedLeads } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'dropped')
    .lt('last_msg_at', sevenDaysAgo)
    .gt('last_msg_at', eightDaysAgo);

  let reengaged = 0;
  for (const lead of (droppedLeads || [])) {
    const { data: reengageMsg } = await supabase
      .from('messages')
      .select('id')
      .eq('phone', lead.phone)
      .eq('template_name', 'reengage_7day')
      .limit(1);

    if (reengageMsg && reengageMsg.length > 0) continue;

    await sendWhatsApp(lead.phone, 'reengage_7day', {
      name: lead.name || 'there',
      templateParams: [lead.name || 'there']
    }).catch(() => {});

    await supabase.from('messages').insert({
      phone: lead.phone,
      direction: 'out',
      body: '7-day re-engage attempt',
      template_name: 'reengage_7day',
      sent_at: new Date().toISOString(),
      status: 'sent'
    });

    reengaged++;
  }

  return res.status(200).json({ success: true, nudged, dropped, reengaged });
};
