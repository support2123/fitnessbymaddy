const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalate');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const now = new Date();
  const results = [];

  // Nudge leads who haven't responded after 2 hours (Flow A step 3)
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const { data: stalledLeads } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('created_at', twoHoursAgo)
    .gt('created_at', twentyFourHoursAgo);

  for (const lead of (stalledLeads || [])) {
    const { data: msgs } = await supabase
      .from('messages')
      .select('id')
      .eq('phone', lead.phone)
      .eq('template_name', 'nudge_trial')
      .limit(1);

    if (msgs && msgs.length > 0) continue;

    await sendWhatsApp(lead.phone, 'nudge_trial', {
      name: lead.name || 'there',
      templateParams: [lead.name || 'there', 'https://fitnessbymaddy.com/program-trial.html']
    });
    results.push({ phone: lead.phone, action: 'nudged' });
  }

  // Drop leads with no reply after 24 hours
  const { data: deadLeads } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('created_at', twentyFourHoursAgo);

  for (const lead of (deadLeads || [])) {
    await supabase
      .from('leads')
      .update({ status: 'dropped' })
      .eq('id', lead.id);
    results.push({ phone: lead.phone, action: 'dropped' });
  }

  // Nudge active clients with pending check-ins
  const { data: activeClients } = await supabase
    .from('clients')
    .select('*')
    .eq('status', 'active');

  for (const client of (activeClients || [])) {
    const startDate = new Date(client.program_started_at);
    const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
    const weekNo = Math.floor(daysSinceStart / 7) + 1;

    const { data: checkin } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .single();

    if (checkin) continue;

    // Check how many consecutive weeks missed
    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('week_no')
      .eq('client_id', client.id)
      .order('week_no', { ascending: false })
      .limit(2);

    const lastSubmitted = recentCheckins?.[0]?.week_no || 0;
    const missedWeeks = weekNo - lastSubmitted;

    if (missedWeeks >= 2) {
      await escalateToMaddy(
        '2 consecutive missed check-ins',
        `Client: ${client.name} | Phone: ${client.phone} | Last submitted: Week ${lastSubmitted}`
      );
    }

    // Send nudge if it's been 24+ hours since Sunday
    const dayOfWeek = now.getDay();
    if (dayOfWeek >= 1) {
      await sendWhatsApp(client.phone, 'checkin_reminder', {
        name: client.name,
        templateParams: [
          client.name,
          `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`
        ]
      });
    }
  }

  return res.status(200).json({ processed: results.length, results });
};
