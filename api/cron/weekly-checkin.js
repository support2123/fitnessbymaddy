const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { escalateToMaddy, checkMissedCheckins } = require('../lib/escalation');
const { maskPhone } = require('../lib/mask-phone');

const CHECKIN_BASE = 'https://www.fitnessbymaddy.com/checkin.html';

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getSupabase();
  const summary = { processed: 0, sent: 0, skipped: 0, escalated: 0 };

  try {
    // 1. Get all active clients
    const { data: clients, error: fetchErr } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (fetchErr) {
      console.error('Failed to fetch clients:', fetchErr.message);
      return res.status(500).json({ error: 'Failed to fetch clients' });
    }

    if (!clients || clients.length === 0) {
      console.log('No active clients found');
      return res.status(200).json({ ok: true, ...summary });
    }

    const now = new Date();

    for (const client of clients) {
      summary.processed++;

      // a. Calculate current week_no based on program_started_at
      const startedAt = new Date(client.program_started_at);
      const msPerWeek = 7 * 24 * 60 * 60 * 1000;
      const weekNo = Math.ceil((now - startedAt) / msPerWeek);

      if (weekNo < 1) {
        console.log(`Client ${maskPhone(client.phone)} hasn't started yet, skipping`);
        summary.skipped++;
        continue;
      }

      // b. Check if program has ended
      if (client.program_ends_at && now > new Date(client.program_ends_at)) {
        console.log(`Client ${maskPhone(client.phone)} program ended, marking completed`);
        await db
          .from('clients')
          .update({ status: 'completed' })
          .eq('id', client.id);
        summary.skipped++;
        continue;
      }

      // c. Check if checkin for this week already submitted
      const { data: existing } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (existing && existing.length > 0) {
        console.log(`Client ${maskPhone(client.phone)} already checked in for week ${weekNo}, skipping`);
        summary.skipped++;
        continue;
      }

      // d. Send WhatsApp with check-in form link
      const checkinUrl = `${CHECKIN_BASE}?c=${client.id}&w=${weekNo}`;
      const message = `Hey ${client.name || 'there'}! Time for your Week ${weekNo} check-in. Fill it out here: ${checkinUrl}`;

      const result = await sendWhatsApp(client.phone, message, 'weekly_checkin');
      if (result.ok) {
        summary.sent++;
        console.log(`Check-in reminder sent to ${maskPhone(client.phone)} for week ${weekNo}`);
      } else {
        console.log(`Failed to send check-in to ${maskPhone(client.phone)}: ${result.reason || 'unknown'}`);
        summary.skipped++;
      }

      // e. Check for 2 consecutive missed check-ins
      const missed = await checkMissedCheckins(client.id, db);
      if (missed) {
        await escalateToMaddy('2 consecutive missed check-ins', {
          phone: client.phone,
          name: client.name || 'Unknown',
          message: `Client has missed 2+ consecutive check-ins (current week: ${weekNo})`,
        });
        summary.escalated++;
        console.log(`Escalated missed check-ins for ${maskPhone(client.phone)}`);
      }
    }

    console.log(`Weekly check-in cron complete: ${JSON.stringify(summary)}`);
    return res.status(200).json({ ok: true, ...summary });
  } catch (err) {
    console.error('weekly-checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
