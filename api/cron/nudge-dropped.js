const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const db = getSupabase();
  const results = { nudged_2hr: 0, nudged_24hr: 0, dropped: 0, checkin_nudge_24hr: 0, checkin_nudge_48hr: 0 };

  try {
    const now = new Date();

    // --- Lead nudges ---
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const fourHoursAgo = new Date(now - 4 * 60 * 60 * 1000).toISOString();
    const { data: newLeads2hr } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo)
      .gte('created_at', fourHoursAgo);

    for (const lead of (newLeads2hr || [])) {
      const { data: replies } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gte('sent_at', lead.created_at)
        .limit(2);

      if (!replies || replies.length <= 1) {
        await sendWhatsApp({
          phone: lead.phone,
          templateName: 'nudge_trial',
          bodyValues: [
            lead.name || 'there',
            'https://www.fitnessbymaddy.com/shred.html',
          ],
        });
        results.nudged_2hr++;
      }
    }

    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const thirtyHoursAgo = new Date(now - 30 * 60 * 60 * 1000).toISOString();
    const { data: newLeads24hr } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twentyFourHoursAgo)
      .gte('created_at', thirtyHoursAgo);

    for (const lead of (newLeads24hr || [])) {
      const { data: replies } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gte('sent_at', lead.created_at)
        .limit(2);

      if (!replies || replies.length <= 1) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        results.dropped++;
      }
    }

    // --- Re-engage dropped leads (7-day rule) ---
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString();
    const { data: reEngageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lte('last_msg_at', sevenDaysAgo)
      .gte('last_msg_at', eightDaysAgo);

    for (const lead of (reEngageLeads || [])) {
      await sendWhatsApp({
        phone: lead.phone,
        templateName: 'reengage_7day',
        bodyValues: [lead.name || 'there'],
      });
      results.nudged_24hr++;
    }

    // --- Check-in nudges for active clients ---
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    for (const client of (activeClients || [])) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) continue;

      const { data: checkin } = await db
        .from('checkins')
        .select('id, form_submitted_at')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (checkin && checkin.length > 0) continue;

      const sundayOfThisWeek = new Date(now);
      sundayOfThisWeek.setDate(sundayOfThisWeek.getDate() - sundayOfThisWeek.getDay());
      sundayOfThisWeek.setHours(3, 30, 0, 0);

      const hoursSinceSunday = (now - sundayOfThisWeek) / (1000 * 60 * 60);

      const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

      if (hoursSinceSunday >= 24 && hoursSinceSunday < 30) {
        await sendWhatsApp({
          phone: client.phone,
          templateName: 'checkin_nudge',
          bodyValues: [client.name || 'there', checkinUrl],
        });
        results.checkin_nudge_24hr++;
      } else if (hoursSinceSunday >= 48 && hoursSinceSunday < 54) {
        await sendWhatsApp({
          phone: client.phone,
          templateName: 'checkin_nudge_final',
          bodyValues: [client.name || 'there', checkinUrl],
        });
        results.checkin_nudge_48hr++;
      }
    }

    return res.json(results);

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
