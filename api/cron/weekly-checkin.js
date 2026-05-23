// GET /api/cron/weekly-checkin
// Vercel Cron — runs every Sunday at 9 AM IST (03:30 UTC, schedule: "30 3 * * 0").
// Sends a WhatsApp check-in form reminder to every active client who hasn't
// submitted a check-in for their current program week.

const { supabase } = require('../lib/supabase');
const { sendWhatsApp, maskPhone } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Verify Vercel cron secret
  const authHeader = req.headers['authorization'] || '';
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    console.warn('weekly-checkin cron: unauthorized request');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // 1. Fetch all active clients with their program start date
    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('id, phone, name, program, program_started_at')
      .eq('status', 'active');

    if (clientsError) {
      console.error('weekly-checkin: failed to fetch clients:', clientsError.message);
      return res.status(500).json({ error: 'Failed to fetch clients' });
    }

    let remindersSent = 0;
    let skippedAlreadySubmitted = 0;
    let skippedNoStartDate = 0;
    const errors = [];

    const now = new Date();

    for (const client of clients || []) {
      try {
        // 2a. Calculate current week_no based on program_started_at
        if (!client.program_started_at) {
          console.log(`Skipping ${maskPhone(client.phone)}: no program_started_at`);
          skippedNoStartDate++;
          continue;
        }

        const startedAt = new Date(client.program_started_at);
        const msPerWeek = 7 * 24 * 60 * 60 * 1000;
        const weeksSinceStart = Math.floor((now - startedAt) / msPerWeek);
        // week_no is 1-indexed; if program just started, it's week 1
        const week_no = Math.max(1, weeksSinceStart + 1);

        // 2b. Check if a check-in already exists for this week
        const { data: existingCheckin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', week_no)
          .maybeSingle();

        if (existingCheckin) {
          skippedAlreadySubmitted++;
          continue;
        }

        // 2c. No check-in submitted → send reminder via WhatsApp
        const checkinLink = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${week_no}`;

        const result = await sendWhatsApp(
          client.phone,
          'weekly_checkin',
          [client.name || 'there', String(week_no), checkinLink],
          true // isClient — bypass rate limit
        );

        if (result.success) {
          remindersSent++;
          console.log(`Reminder sent to ${maskPhone(client.phone)}, week ${week_no}`);
        } else {
          console.warn(`Reminder failed for ${maskPhone(client.phone)}: ${result.reason}`);
          errors.push({ phone: maskPhone(client.phone), reason: result.reason });
        }
      } catch (clientErr) {
        console.error(`Error processing ${maskPhone(client.phone)}:`, clientErr.message);
        errors.push({ phone: maskPhone(client.phone), reason: clientErr.message });
      }
    }

    const summary = {
      success: true,
      total_active: (clients || []).length,
      reminders_sent: remindersSent,
      skipped_submitted: skippedAlreadySubmitted,
      skipped_no_start_date: skippedNoStartDate,
      errors: errors.length > 0 ? errors : undefined
    };

    console.log('weekly-checkin cron summary:', JSON.stringify(summary));
    return res.status(200).json(summary);
  } catch (err) {
    console.error('weekly-checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
