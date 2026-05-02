const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cronSecret = req.headers['x-vercel-cron'];
  const authHeader = req.headers.authorization || '';
  if (!cronSecret && authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = getSupabase();

  // Nudge new leads who haven't replied in 2 hours
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: staleLeads } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('created_at', twoHoursAgo)
    .gt('created_at', twentyFourHoursAgo);

  let nudged = 0;
  if (staleLeads) {
    for (const lead of staleLeads) {
      const { data: msgs } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 'nudge_trial')
        .limit(1);

      if (msgs && msgs.length > 0) continue;

      await sendWhatsApp(lead.phone, 'nudge_trial', [
        lead.name || 'there'
      ]);
      nudged++;
    }
  }

  // Drop leads older than 24 hours with no reply
  const { data: expiredLeads } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('created_at', twentyFourHoursAgo);

  let dropped = 0;
  if (expiredLeads) {
    for (const lead of expiredLeads) {
      const { data: replies } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gt('sent_at', lead.created_at)
        .limit(1);

      if (replies && replies.length > 0) continue;

      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('id', lead.id);
      dropped++;
    }
  }

  // Nudge active clients with pending check-ins (24hr + 48hr reminders)
  const { data: pendingClients } = await supabase
    .from('clients')
    .select('*')
    .eq('status', 'active');

  let clientNudges = 0;
  if (pendingClients) {
    for (const client of pendingClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);
      const dayOfWeek = now.getDay();

      // Only nudge on Mon (day after Sun send) and Tue
      if (dayOfWeek !== 1 && dayOfWeek !== 2) continue;

      const { data: checkin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (checkin && checkin.length > 0) continue;

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
      await sendWhatsApp(client.phone, 'checkin_reminder', [
        client.name || 'there',
        checkinUrl
      ]);
      clientNudges++;
    }
  }

  // Flag clients with 2+ consecutive missed check-ins
  if (pendingClients) {
    for (const client of pendingClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 3) continue;

      const { data: recentCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .gte('week_no', currentWeek - 2);

      if (!recentCheckins || recentCheckins.length === 0) {
        const { escalateToMaddy } = require('../lib/escalation');
        await escalateToMaddy('2 consecutive missed check-ins', {
          phone: client.phone,
          message: `Client ${client.name} missed weeks ${currentWeek - 1} and ${currentWeek}`
        });
      }
    }
  }

  return res.status(200).json({ success: true, nudged, dropped, clientNudges });
};
