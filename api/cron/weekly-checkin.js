const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, canSendMessage } = require('../../lib/whatsapp');
const { checkMissedCheckins } = require('../../lib/escalation');

const BASE_URL = process.env.BASE_URL || 'https://www.fitnessbymaddy.com';

module.exports = async function handler(req, res) {
  // Verify cron authorization (Vercel sends this header)
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    // Allow if no CRON_SECRET is set (dev mode)
    if (process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    const db = getSupabase();

    // Get all active clients
    const { data: clients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let skipped = 0;

    for (const client of clients) {
      // Calculate current week number
      const startDate = new Date(client.program_started_at);
      const weekNo = Math.ceil((Date.now() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000));

      // Skip if program is over
      if (client.program_ends_at && new Date() > new Date(client.program_ends_at)) {
        await db.from('clients')
          .update({ status: 'completed' })
          .eq('id', client.id);
        continue;
      }

      // Check if already submitted this week
      const { data: existing } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .maybeSingle();

      if (existing) {
        skipped++;
        continue;
      }

      // Send check-in form link
      const formUrl = `${BASE_URL}/checkin?c=${client.id}&w=${weekNo}`;
      const market = client.phone && client.phone.startsWith('91') ? 'IN' : 'GLOBAL';
      const isHinglish = market === 'IN';

      const msg = isHinglish
        ? `Week ${weekNo} check-in time! Form bharo aur progress track karo`
        : `Week ${weekNo} check-in time! Fill out your form to track progress`;

      await sendTemplate(client.phone, 'weekly_checkin', [
        client.name || 'there',
        msg,
        formUrl
      ]);

      sent++;
    }

    // Check for missed check-ins and escalate
    await checkMissedCheckins(db);

    return res.status(200).json({
      message: 'Weekly check-in cron complete',
      sent,
      skipped,
      total: clients.length
    });

  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
