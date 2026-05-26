const { supabase } = require('../_lib/supabase');
const { sendTemplate, maskPhone } = require('../_lib/whatsapp');
const { PROGRAMS } = require('../_lib/constants');

/**
 * Weekly check-in cron — runs every Sunday 9am IST.
 * Sends check-in form links to all active clients whose
 * current week hasn't been checked in yet.
 */
module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify cron secret
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const summary = { processed: 0, sent: 0, skipped: 0, errors: [] };

  try {
    // Fetch all active clients
    const { data: clients, error: clientsErr } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (clientsErr) {
      console.error('[weekly-checkin] Failed to fetch clients:', clientsErr.message);
      return res.status(500).json({ error: 'Failed to fetch clients' });
    }

    if (!clients || clients.length === 0) {
      return res.status(200).json({ ...summary, message: 'No active clients' });
    }

    const now = new Date();

    for (const client of clients) {
      summary.processed++;

      try {
        // Calculate current week number
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.floor(daysSinceStart / 7) + 1;

        // Check if program is completed
        const programMeta = PROGRAMS[client.program] || {};
        const totalWeeks = Math.ceil((programMeta.duration || 42) / 7);
        if (weekNo > totalWeeks) {
          // Program completed — update status
          await supabase
            .from('clients')
            .update({ status: 'completed' })
            .eq('id', client.id);

          console.log(`[weekly-checkin] Client ${client.id} program completed (week ${weekNo}/${totalWeeks})`);
          summary.skipped++;
          continue;
        }

        // Check if check-in already exists for this week
        const { data: existing, error: checkErr } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .limit(1);

        if (checkErr) {
          console.error(`[weekly-checkin] Check-in lookup failed for client ${client.id}:`, checkErr.message);
          summary.errors.push({ client_id: client.id, error: checkErr.message });
          continue;
        }

        if (existing && existing.length > 0) {
          console.log(`[weekly-checkin] Client ${client.id} already checked in for week ${weekNo}`);
          summary.skipped++;
          continue;
        }

        // Send WhatsApp with check-in form link
        const formLink = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
        const result = await sendTemplate(client.phone, 'weekly_checkin', {
          name: client.name,
          templateParams: [client.name, String(weekNo), formLink],
        });

        if (result.success) {
          console.log(`[weekly-checkin] Sent check-in to ${maskPhone(client.phone)} (week ${weekNo})`);

          await supabase.from('nudge_log').insert({
            phone: client.phone,
            nudge_type: `checkin_reminder_w${weekNo}`,
            sent_at: new Date().toISOString(),
          });

          summary.sent++;
        } else {
          console.error(`[weekly-checkin] Failed to send to ${maskPhone(client.phone)}`);
          summary.skipped++;
        }
      } catch (clientErr) {
        console.error(`[weekly-checkin] Error processing client ${client.id}:`, clientErr.message);
        summary.errors.push({ client_id: client.id, error: clientErr.message });
      }
    }

    console.log(`[weekly-checkin] Done — processed: ${summary.processed}, sent: ${summary.sent}, skipped: ${summary.skipped}`);
    return res.status(200).json(summary);
  } catch (err) {
    console.error('[weekly-checkin] Unexpected error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
