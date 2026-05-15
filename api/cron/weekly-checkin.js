const { supabase } = require('../../lib/supabase');
const { sendTextMessage, canSendMessage } = require('../../lib/whatsapp');
const { detectMarket, isHinglish } = require('../../lib/market');
const { checkMissedCheckins } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  // Verify Vercel cron auth
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Get all active clients
    const { data: clients, error } = await supabase()
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (error || !clients) {
      return res.status(500).json({ error: 'Failed to fetch clients' });
    }

    let sent = 0;
    let skipped = 0;
    let nudged = 0;

    for (const client of clients) {
      // Calculate current week number
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

      // Check if program has ended
      if (client.program_ends_at && now > new Date(client.program_ends_at)) {
        await supabase()
          .from('clients')
          .update({ status: 'completed' })
          .eq('id', client.id);
        skipped++;
        continue;
      }

      // Check if they already submitted this week
      const { data: existing } = await supabase()
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (existing && existing.length > 0) {
        skipped++;
        continue;
      }

      // Check for missed check-ins
      await checkMissedCheckins(client.id, client.phone);

      // Send check-in form link
      const market = detectMarket(client.phone);
      const hinglish = isHinglish(market);
      const formUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

      const message = hinglish
        ? `Hey ${client.name || 'there'}! 🏋️ Week ${weekNo} check-in time!\n\nYeh form fill karo — weight, measurements, aur photos.\n${formUrl}\n\nConsistency hi key hai! 💪`
        : `Hey ${client.name || 'there'}! 🏋️ Week ${weekNo} check-in time!\n\nPlease fill out your weekly form — weight, measurements, and photos.\n${formUrl}\n\nConsistency is key! 💪`;

      await sendTextMessage(client.phone, message);
      sent++;
    }

    // Handle nudges for clients who haven't submitted recent check-ins
    // Check clients who were sent a form 24hrs or 48hrs ago but haven't submitted
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

    const { data: pendingNudges } = await supabase()
      .from('messages')
      .select('phone, body')
      .eq('direction', 'out')
      .like('body', '%check-in time%')
      .gte('sent_at', twoDaysAgo.toISOString())
      .lte('sent_at', oneDayAgo.toISOString());

    if (pendingNudges) {
      for (const msg of pendingNudges) {
        const { data: client } = await supabase()
          .from('clients')
          .select('id, name, phone')
          .eq('phone', msg.phone)
          .eq('status', 'active')
          .single();

        if (!client) continue;

        const startDate = new Date();
        const weekNo = Math.ceil((startDate - new Date()) / (7 * 24 * 60 * 60 * 1000)) || 1;

        const { data: submitted } = await supabase()
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .gte('form_submitted_at', twoDaysAgo.toISOString())
          .limit(1);

        if (!submitted || submitted.length === 0) {
          const canSend = await canSendMessage(client.phone, true);
          if (canSend) {
            await sendTextMessage(
              client.phone,
              `Reminder: Your weekly check-in is still pending! 📋 Don't skip it — tracking = results. Fill it out now 👇`
            );
            nudged++;
          }
        }
      }
    }

    return res.status(200).json({
      ok: true,
      sent,
      skipped,
      nudged,
      total_clients: clients.length
    });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
