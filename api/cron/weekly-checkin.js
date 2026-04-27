const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('../../lib/whatsapp');
const { json, maskPhone } = require('../../lib/utils');

module.exports = async function handler(req, res) {
  // Verify cron secret (Vercel sends this header for cron jobs)
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return json(res, { error: 'Unauthorized' }, 401);
  }

  const db = getSupabase();

  try {
    // Get all active clients
    const { data: clients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return json(res, { message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of clients) {
      // Calculate current week number
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

      if (weekNo < 1) continue;

      // Check if program has ended
      if (client.program_ends_at && now > new Date(client.program_ends_at)) {
        await db.from('clients').update({ status: 'completed' }).eq('id', client.id);
        continue;
      }

      // Check if check-in already submitted for this week
      const { data: existing } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) continue;

      // Check for consecutive missed check-ins (escalation trigger)
      const { data: recentCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      const lastCheckedIn = recentCheckins?.[0]?.week_no || 0;
      if (weekNo - lastCheckedIn >= 3) {
        await notifyMaddy(
          `2+ missed check-ins: ${client.name || maskPhone(client.phone)} — last check-in week ${lastCheckedIn}, now week ${weekNo}`
        );
        escalated++;
      }

      // Send check-in form link
      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const market = client.phone.startsWith('91') ? 'IN' : 'GLOBAL';
      const isHinglish = market === 'IN';

      await sendWhatsApp({
        phone: client.phone,
        templateName: 'weekly_checkin',
        params: [
          client.name || 'there',
          String(weekNo),
          checkinUrl,
        ],
      });

      // Create empty check-in record to track pending state
      await db.from('checkins').insert({
        client_id: client.id,
        week_no: weekNo,
      });

      sent++;
    }

    return json(res, { sent, escalated, total: clients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return json(res, { error: 'Internal error' }, 500);
  }
};
