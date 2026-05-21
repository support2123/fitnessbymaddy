const { getClient } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');
const { maskPhone } = require('../_lib/helpers');

module.exports = async function handler(req, res) {
  /* ── Verify Vercel Cron auth ── */
  if (req.headers.authorization !== 'Bearer ' + process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let sent = 0;

  try {
    const db = getClient();

    /* ── 1. Fetch all active clients ── */
    const { data: clients, error } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (error) throw error;
    if (!clients || clients.length === 0) {
      return res.status(200).json({ ok: true, sent: 0, message: 'No active clients' });
    }

    for (const client of clients) {
      try {
        /* ── 2a. Calculate current week number ── */
        const weekNo = Math.ceil(
          (Date.now() - new Date(client.program_started_at).getTime()) /
          (7 * 24 * 60 * 60 * 1000)
        );

        /* ── 2b. Check if program duration exceeded ── */
        const programWeeks = parseProgramDuration(client.program);
        if (programWeeks && weekNo > programWeeks) {
          await db
            .from('clients')
            .update({ status: 'completed' })
            .eq('id', client.id);
          continue;
        }

        /* ── 2c. Check if checkin already exists for this week ── */
        const { data: existing } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .limit(1);

        if (existing && existing.length > 0) continue;

        /* ── 2d. Build check-in form URL ── */
        const formUrl = `${process.env.SITE_URL}/checkin?c=${client.id}&w=${weekNo}`;

        /* ── 2e. Send WhatsApp template ── */
        await sendTemplate(client.phone, 'weekly_checkin', [
          client.name || 'there',
          String(weekNo),
          formUrl
        ]);

        sent++;
      } catch (clientErr) {
        console.error(
          `[weekly-checkin] Error for client ${maskPhone(client.phone || '')}: ${clientErr.message}`
        );
        /* Continue processing remaining clients */
      }
    }

    return res.status(200).json({ ok: true, sent });
  } catch (err) {
    console.error(`[weekly-checkin] Fatal error: ${err.message}`);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Extract duration in weeks from program identifier.
 * Matches patterns like "6wk_gym" -> 6, "12wk" -> 12.
 */
function parseProgramDuration(program) {
  if (!program) return null;
  const match = program.match(/^(\d+)wk/);
  if (match) return parseInt(match[1], 10);
  const fixedDurations = { pcos: 6, '40plus': 6, zoom_trial: 1, zoom_pack: 8 };
  return fixedDurations[program] || null;
}
