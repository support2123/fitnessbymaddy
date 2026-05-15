const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('../_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    // --- PART 1: Re-engage dropped leads (7-day rule) ---
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', eightDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    let reengaged = 0;
    if (droppedLeads) {
      for (const lead of droppedLeads) {
        try {
          await sendWhatsApp(lead.phone, 'reengage_7day', [
            lead.name || 'there'
          ]);
          reengaged++;
        } catch (e) {
          console.error('Re-engage error:', e.message);
        }
      }
    }

    // --- PART 2: Nudge clients with missing check-ins ---
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let nudged = 0;
    let escalated = 0;

    if (activeClients) {
      for (const client of activeClients) {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSinceStart / 7);

        if (currentWeek < 1) continue;

        const { data: recentCheckins } = await db
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(3);

        const submittedWeeks = recentCheckins
          ? recentCheckins.map(c => c.week_no)
          : [];

        if (!submittedWeeks.includes(currentWeek)) {
          const dayOfWeek = now.getDay();
          // 24hr nudge (Monday)
          if (dayOfWeek === 1) {
            await sendWhatsApp(client.phone, 'checkin_nudge', [
              client.name || 'there',
              `${currentWeek}`
            ]);
            nudged++;
          }
          // 48hr nudge (Tuesday)
          if (dayOfWeek === 2) {
            await sendWhatsApp(client.phone, 'checkin_nudge_urgent', [
              client.name || 'there',
              `${currentWeek}`
            ]);
            nudged++;
          }
        }

        const missedConsecutive = [];
        for (let w = currentWeek - 1; w >= Math.max(1, currentWeek - 2); w--) {
          if (!submittedWeeks.includes(w)) missedConsecutive.push(w);
        }

        if (missedConsecutive.length >= 2) {
          await notifyMaddy(
            '2 consecutive missed check-ins',
            `Client: ${client.name || client.phone}\nMissed weeks: ${missedConsecutive.join(', ')}`
          );
          escalated++;
        }
      }
    }

    return res.status(200).json({ reengaged, nudged, escalated });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
