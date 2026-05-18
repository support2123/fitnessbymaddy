const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('../_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    // PART 1: Nudge new leads that haven't replied (2hr and 24hr rules)
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000);
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

    const { data: staleNewLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo.toISOString())
      .gt('created_at', twentyFourHoursAgo.toISOString());

    let nudged = 0;
    for (const lead of (staleNewLeads || [])) {
      const { data: msgs } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 'nudge_trial')
        .limit(1);

      if (msgs && msgs.length > 0) continue;

      await sendWhatsApp(lead.phone, 'nudge_trial', {
        name: lead.name || 'there',
        templateParams: [
          lead.name || 'there',
          'https://fitnessbymaddy.com/program-trial.html'
        ]
      });
      nudged++;
    }

    // PART 2: Drop leads that are 24hr+ with no reply
    const { data: deadLeads } = await db
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lt('created_at', twentyFourHoursAgo.toISOString());

    let dropped = 0;
    for (const lead of (deadLeads || [])) {
      const { data: replies } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gt('sent_at', lead.created_at || twentyFourHoursAgo.toISOString())
        .limit(1);

      if (replies && replies.length > 0) continue;

      await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
      dropped++;
    }

    // PART 3: Re-engage dropped leads (7-day rule — one attempt only)
    const { data: reengageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gt('created_at', sevenDaysAgo.toISOString());

    let reengaged = 0;
    for (const lead of (reengageLeads || [])) {
      const { data: reengage_msgs } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 'reengage_7day')
        .limit(1);

      if (reengage_msgs && reengage_msgs.length > 0) continue;

      await sendWhatsApp(lead.phone, 'reengage_7day', {
        name: lead.name || 'there',
        templateParams: [lead.name || 'there']
      });
      reengaged++;
    }

    // PART 4: Flag clients with 2+ missed consecutive check-ins
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let escalated = 0;
    for (const client of (activeClients || [])) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 3) continue;

      const { data: recentCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .in('week_no', [currentWeek - 1, currentWeek - 2]);

      if (!recentCheckins || recentCheckins.length === 0) {
        await notifyMaddy(
          '2 Missed Check-ins',
          `${client.name} has missed weeks ${currentWeek - 2} and ${currentWeek - 1}. May need follow-up.`
        );
        escalated++;
      }
    }

    // PART 5: Nudge clients with pending check-ins (+24hr, +48hr)
    let clientNudged = 0;
    for (const client of (activeClients || [])) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);
      const dayInWeek = daysSinceStart % 7;

      if (dayInWeek !== 1 && dayInWeek !== 2) continue;

      const { data: checkin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .limit(1);

      if (checkin && checkin.length > 0) continue;

      const templateName = dayInWeek === 1 ? 'checkin_nudge_24h' : 'checkin_nudge_48h';
      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;

      await sendWhatsApp(client.phone, templateName, {
        name: client.name,
        templateParams: [client.name, checkinUrl]
      });
      clientNudged++;
    }

    return res.status(200).json({
      nudged,
      dropped,
      reengaged,
      escalated,
      clientNudged
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
