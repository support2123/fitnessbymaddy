const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, detectMarket } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !isVercelCron(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabase = getSupabase();
    const now = new Date();

    // Nudge leads who haven't replied in 2 hours (new leads)
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Mark 24h no-reply leads as dropped
    await supabase
      .from('leads')
      .update({ status: 'dropped' })
      .eq('status', 'new')
      .lt('last_msg_at', twentyFourHoursAgo);

    // Send 2-hour nudge for new leads
    const { data: newLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gte('last_msg_at', twentyFourHoursAgo);

    let nudged = 0;
    if (newLeads) {
      for (const lead of newLeads) {
        const { data: msgs } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'nudge_trial')
          .limit(1);

        if (msgs && msgs.length > 0) continue;

        const market = detectMarket(lead.phone);
        const params = market === 'IN'
          ? ['https://fitnessbymaddy.com/program-trial.html']
          : ['https://fitnessbymaddy.com/program-trial.html'];

        await sendWhatsApp(lead.phone, 'nudge_trial', params);
        nudged++;
      }
    }

    // Check for clients with 2 consecutive missed check-ins
    const { data: activeClients } = await supabase
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    let escalated = 0;
    if (activeClients) {
      for (const client of activeClients) {
        const currentWeek = calculateWeekNo(client.program_started_at);
        if (currentWeek < 3) continue;

        const { data: recentCheckins } = await supabase
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .gte('week_no', currentWeek - 2)
          .order('week_no', { ascending: false });

        if (!recentCheckins || recentCheckins.length === 0) {
          await escalateToMaddy('2 consecutive missed check-ins', {
            phone: client.phone,
            message: `${client.name} missed weeks ${currentWeek - 1} and ${currentWeek - 2}`,
          });
          escalated++;
        }
      }
    }

    // Re-engage dropped leads (7-day rule: try once after 7 days)
    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', sevenDaysAgo)
      .lt('last_msg_at', new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString());

    let reengaged = 0;
    if (droppedLeads) {
      for (const lead of droppedLeads) {
        const { data: msgs } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'reengage_7day')
          .limit(1);

        if (msgs && msgs.length > 0) continue;

        await sendWhatsApp(lead.phone, 'reengage_7day', [lead.name || 'there']);
        reengaged++;
      }
    }

    return res.status(200).json({ status: 'done', nudged, escalated, reengaged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateWeekNo(startDate) {
  if (!startDate) return 0;
  const start = new Date(startDate);
  const now = new Date();
  return Math.floor((now - start) / (7 * 24 * 60 * 60 * 1000)) + 1;
}

function isVercelCron(req) {
  return req.headers['x-vercel-cron'] === '1';
}
