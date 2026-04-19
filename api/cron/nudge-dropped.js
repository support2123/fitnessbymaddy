const { supabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { isHinglish, cors } = require('../../lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);

  const authHeader = req.headers.authorization;
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  if (!isCron && req.method !== 'GET') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    const results = [];

    // 2-hour nudge: new leads with no reply
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString();

    const { data: staleNewLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', fourHoursAgo);

    for (const lead of (staleNewLeads || [])) {
      const { count } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gt('sent_at', lead.created_at);

      if (count === 0) {
        await sendWhatsApp({
          phone: lead.phone,
          templateName: 'nudge_trial',
          bodyValues: [
            lead.name || 'there',
            'https://fitnessbymaddy.com/intake?lead=' + lead.id
          ]
        });
        results.push({ phone_masked: lead.phone.slice(-4), action: '2hr_nudge' });
      }
    }

    // 24-hour drop: new leads still silent
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();

    const { data: deadLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twentyFourHoursAgo)
      .gt('created_at', fortyEightHoursAgo);

    for (const lead of (deadLeads || [])) {
      const { count } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gt('sent_at', lead.created_at);

      if (count === 0) {
        await supabase
          .from('leads')
          .update({ status: 'dropped' })
          .eq('id', lead.id);
        results.push({ phone_masked: lead.phone.slice(-4), action: '24hr_dropped' });
      }
    }

    // 7-day re-engagement: dropped leads from 7+ days ago (one attempt only)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reengageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo)
      .gt('last_msg_at', eightDaysAgo);

    for (const lead of (reengageLeads || [])) {
      const { count } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('template_name', 'reengage_7day');

      if (count === 0) {
        await sendWhatsApp({
          phone: lead.phone,
          templateName: 'reengage_7day',
          bodyValues: [lead.name || 'there']
        });
        results.push({ phone_masked: lead.phone.slice(-4), action: '7day_reengage' });
      }
    }

    // Checkin nudges: clients who haven't submitted this week's checkin (+24hr, +48hr)
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    for (const client of (activeClients || [])) {
      const weekNo = calculateCurrentWeek(client);

      const { data: checkin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .maybeSingle();

      if (!checkin) {
        const dayOfWeek = now.getDay(); // 0=Sun
        if (dayOfWeek === 1 || dayOfWeek === 2) {
          const templateName = dayOfWeek === 1 ? 'checkin_nudge_24h' : 'checkin_nudge_48h';
          await sendWhatsApp({
            phone: client.phone,
            templateName,
            bodyValues: [
              client.name || 'there',
              `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`
            ]
          });
          results.push({ client_id: client.id, action: `checkin_nudge_${dayOfWeek === 1 ? '24h' : '48h'}` });
        }
      }
    }

    return res.status(200).json({ processed: results.length, results });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateCurrentWeek(client) {
  const started = new Date(client.program_started_at);
  const now = new Date();
  const diffMs = now - started;
  return Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1;
}
