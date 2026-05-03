const { supabase } = require('../lib/supabase');
const { sendTemplate, sendTextMessage, notifyMaddy } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cronSecret = req.headers['authorization'];
  if (cronSecret && cronSecret !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();

    // TASK 1: Nudge new leads who haven't replied in 2 hours
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const { data: staleNewLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', new Date(now - 24 * 60 * 60 * 1000).toISOString());

    let nudged = 0;
    for (const lead of (staleNewLeads || [])) {
      const { data: outMsgs } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .gt('sent_at', lead.created_at);

      if (outMsgs && outMsgs.length < 2) {
        await sendTemplate(lead.phone, 'nudge_trial', [lead.name || 'there']);
        nudged++;
      }
    }

    // TASK 2: Drop leads with no reply after 24 hours
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const { data: expiredLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', oneDayAgo);

    let dropped = 0;
    for (const lead of (expiredLeads || [])) {
      const { data: replies } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gt('sent_at', lead.created_at)
        .limit(1);

      if (!replies || replies.length === 0) {
        await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    // TASK 3: Nudge clients with pending check-ins (24h+ overdue)
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let checkinNudges = 0;
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

      if (!checkin && daysSinceStart % 7 >= 1) {
        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
        await sendTextMessage(client.phone,
          `Hey ${client.name || 'there'}! 👋 Your Week ${weekNo} check-in is pending.\n\n` +
          `Quick 2-min form: ${checkinUrl}\n\n` +
          `This helps Maddy give you the best plan for next week!`
        );
        checkinNudges++;
      }

      // Check for 2 consecutive missed check-ins → escalate
      if (weekNo >= 3) {
        const { data: recentCheckins } = await supabase
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .gte('week_no', weekNo - 2);

        if (!recentCheckins || recentCheckins.length === 0) {
          await notifyMaddy(
            `⚠️ 2 missed check-ins\nClient: ${client.name} (${client.phone})\nProgram: ${client.program}\nLast active: Week ${weekNo - 3}`
          );
        }
      }
    }

    return res.status(200).json({ nudged, dropped, checkinNudges });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
