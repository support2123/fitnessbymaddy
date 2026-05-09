const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, maskPhone } = require('../lib/whatsapp');
const { corsHeaders } = require('../lib/helpers');
const { escalateToMaddy } = require('../lib/escalate');

module.exports = async function handler(req, res) {
  corsHeaders(res);

  // Verify cron secret (Vercel sets this automatically for crons)
  const authHeader = req.headers.authorization || '';
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const results = { sent: 0, nudged: 0, escalated: 0, errors: 0 };

    // Get all active clients
    const { data: clients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ message: 'No active clients', results });
    }

    for (const client of clients) {
      try {
        // Calculate current week number
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

        // Skip if program has ended
        if (client.program_ends_at && now > new Date(client.program_ends_at)) {
          continue;
        }

        // Check if check-in already submitted this week
        const { data: existingCheckin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (existingCheckin) continue;

        // Check for consecutive missed check-ins
        const { data: recentCheckins } = await db
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(3);

        const submittedWeeks = (recentCheckins || []).map(c => c.week_no);
        const missedConsecutive = weekNo > 2 &&
          !submittedWeeks.includes(weekNo - 1) &&
          !submittedWeeks.includes(weekNo - 2);

        if (missedConsecutive) {
          await escalateToMaddy(
            '2 consecutive missed check-ins',
            `Client: ${client.name} (${maskPhone(client.phone)})\nProgram: ${client.program}\nMissed weeks: ${weekNo - 2}, ${weekNo - 1}`
          );
          results.escalated++;
        }

        // Send check-in form link
        const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
        await sendWhatsApp(client.phone, 'weekly_checkin', [
          client.name || 'there',
          String(weekNo),
          checkinUrl
        ], true);

        results.sent++;
      } catch (clientErr) {
        console.error(`Check-in send error for ${maskPhone(client.phone)}:`, clientErr.message);
        results.errors++;
      }
    }

    // Handle nudges: find clients who were sent check-in forms 24h or 48h ago but haven't submitted
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const { data: pendingMessages } = await db
      .from('messages')
      .select('phone, sent_at')
      .eq('direction', 'out')
      .eq('template_name', 'weekly_checkin')
      .gte('sent_at', fortyEightHoursAgo)
      .lte('sent_at', twentyFourHoursAgo);

    if (pendingMessages) {
      for (const msg of pendingMessages) {
        const { data: client } = await db
          .from('clients')
          .select('*')
          .eq('phone', msg.phone)
          .eq('status', 'active')
          .single();

        if (!client) continue;

        const startDate = new Date(client.program_started_at);
        const weekNo = Math.ceil((new Date() - startDate) / (7 * 24 * 60 * 60 * 1000));

        const { data: checkin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (!checkin) {
          const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
          await sendWhatsApp(client.phone, 'checkin_nudge', [
            client.name || 'there',
            checkinUrl
          ], true);
          results.nudged++;
        }
      }
    }

    return res.status(200).json({ success: true, results });

  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
