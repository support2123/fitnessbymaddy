// api/cron/weekly-checkin.js — Sunday 9am IST (3:30 UTC) cron: send check-in forms to active clients

const { supabase } = require('../_lib/supabase');
const { sendTemplate, sendText } = require('../_lib/whatsapp');
const { maskPhone } = require('../_lib/utils');

/**
 * Calculate the current week number for a client based on their program start date.
 */
function getCurrentWeekNo(programStartedAt) {
  const start = new Date(programStartedAt);
  const now = new Date();
  const diffMs = now - start;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.floor(diffDays / 7) + 1;
}

/**
 * Get total weeks for a program type.
 */
function getTotalWeeks(program) {
  const map = {
    '6wk_gym': 6,
    '6wk_home': 6,
    '12wk': 12,
    'pcos': 8,
    '40plus': 8,
    'zoom_trial': 4,
    'zoom_pack': 8,
  };
  return map[program] || 6;
}

module.exports = async function handler(req, res) {
  // Only accept GET (Vercel cron triggers via GET)
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Verify cron auth ──────────────────────────────────────────────
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.warn('[weekly-checkin] Unauthorized cron request');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    console.log('[weekly-checkin] Starting weekly check-in cron job');

    // ── Fetch all active clients ────────────────────────────────────
    const { data: clients, error: fetchErr } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (fetchErr) {
      console.error('[weekly-checkin] Failed to fetch clients:', fetchErr.message);
      return res.status(500).json({ error: 'Failed to fetch clients' });
    }

    if (!clients || clients.length === 0) {
      console.log('[weekly-checkin] No active clients found');
      return res.status(200).json({ processed: 0 });
    }

    console.log(`[weekly-checkin] Processing ${clients.length} active clients`);

    let processed = 0;
    let completed = 0;

    for (const client of clients) {
      const masked = maskPhone(client.phone);

      try {
        const weekNo = getCurrentWeekNo(client.program_started_at);
        const totalWeeks = getTotalWeeks(client.program);

        // ── Program completed ─────────────────────────────────────
        if (weekNo > totalWeeks) {
          console.log(`[weekly-checkin] Client ${client.id} (${masked}) completed program (week ${weekNo}/${totalWeeks})`);

          await supabase
            .from('clients')
            .update({ status: 'completed' })
            .eq('id', client.id);

          await sendText(
            client.phone,
            `Congratulations ${client.name || 'there'}! You've completed your ${totalWeeks}-week program! ` +
            `We're so proud of your journey. Want to continue with a new program? Reply "yes" and we'll set you up!`
          );

          completed++;
          continue;
        }

        // ── Send check-in form link ─────────────────────────────
        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

        console.log(`[weekly-checkin] Sending week ${weekNo} check-in to ${masked}`);

        await sendTemplate(client.phone, 'weekly_checkin', [
          client.name || 'there',
          String(weekNo),
          checkinUrl,
        ]);

        // Also send a text with the link as a fallback
        await sendText(
          client.phone,
          `Hey ${client.name || 'there'}! Time for your Week ${weekNo} check-in. ` +
          `Please fill this out so we can update your program:\n${checkinUrl}`
        );

        // ── Log the check-in form send ──────────────────────────
        await supabase.from('messages').insert({
          phone: client.phone,
          direction: 'out',
          body: `Weekly check-in form sent: week ${weekNo}`,
          template_name: 'weekly_checkin',
          sent_at: new Date().toISOString(),
          status: 'sent',
        });

        // ── Create nudge schedule records ────────────────────────
        // The nudge-dropped cron can pick these up for +24hr and +48hr reminders.
        // We store as message records with a special template_name to track.
        await supabase.from('messages').insert({
          phone: client.phone,
          direction: 'out',
          body: JSON.stringify({
            type: 'checkin_nudge_schedule',
            client_id: client.id,
            week_no: weekNo,
            form_sent_at: new Date().toISOString(),
            nudge_24h: false,
            nudge_48h: false,
          }),
          template_name: 'checkin_nudge_schedule',
          sent_at: new Date().toISOString(),
          status: 'scheduled',
        });

        processed++;
      } catch (clientErr) {
        console.error(`[weekly-checkin] Error processing client ${client.id} (${masked}):`, clientErr.message);
        // Continue with next client
      }
    }

    console.log(`[weekly-checkin] Done: ${processed} check-ins sent, ${completed} programs completed`);

    return res.status(200).json({
      processed,
      completed,
      total_clients: clients.length,
    });
  } catch (err) {
    console.error('[weekly-checkin] Unhandled error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
