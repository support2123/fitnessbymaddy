import { createClient } from '../../lib/supabase.js';
import { sendTemplate } from '../../lib/whatsapp.js';
import { maskPhone } from '../../lib/helpers.js';

// FLOW D — Weekly check-in cron
// Schedule: every Sunday at 9 AM IST (3:30 UTC) — see vercel.json

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export default async function handler(req, res) {
  try {
    // ── 1. Verify cron auth ───────────────────────────────────────
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');

    if (!token || token !== process.env.CRON_SECRET) {
      console.warn('[weekly-checkin] Unauthorized cron request');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const supabase = createClient();
    const now = new Date();

    // ── 2. Fetch all active clients ───────────────────────────────
    const { data: clients, error: clientsErr } = await supabase
      .from('clients')
      .select('id, phone, name, program_started_at, program_ends_at')
      .eq('status', 'active');

    if (clientsErr) {
      console.error('[weekly-checkin] Failed to fetch clients:', clientsErr.message);
      return res.status(500).json({ error: 'Failed to fetch clients' });
    }

    if (!clients || clients.length === 0) {
      console.log('[weekly-checkin] No active clients found');
      return res.status(200).json({ success: true, sent_count: 0, skipped_count: 0 });
    }

    let sentCount = 0;
    let skippedCount = 0;

    // ── 3. Process each client ────────────────────────────────────
    for (const client of clients) {
      const masked = maskPhone(client.phone);

      try {
        const startedAt = new Date(client.program_started_at);
        const daysSinceStart = (now.getTime() - startedAt.getTime()) / MS_PER_DAY;
        const weekNo = Math.ceil(daysSinceStart / 7);

        // 3b. Skip if program has ended
        if (client.program_ends_at && new Date(client.program_ends_at) < now) {
          console.log(`[weekly-checkin] Skipping ${masked}: program ended`);
          skippedCount++;
          continue;
        }

        // Skip week 0 or negative (program hasn't started)
        if (weekNo < 1) {
          console.log(`[weekly-checkin] Skipping ${masked}: program not started yet`);
          skippedCount++;
          continue;
        }

        // 3c. Check if check-in already exists for this client + week
        const { data: existing, error: checkinErr } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .maybeSingle();

        if (checkinErr) {
          console.error(`[weekly-checkin] Checkin lookup failed for ${masked}:`, checkinErr.message);
          skippedCount++;
          continue;
        }

        if (existing) {
          console.log(`[weekly-checkin] Skipping ${masked}: week ${weekNo} checkin exists`);
          skippedCount++;
          continue;
        }

        // 3d. Send WhatsApp template with check-in form link
        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
        const displayName = client.name || 'there';

        const result = await sendTemplate(client.phone, 'weekly_checkin', [
          displayName,
          String(weekNo),
          checkinUrl,
        ]);

        if (result) {
          sentCount++;
          console.log(`[weekly-checkin] Sent week ${weekNo} checkin to ${masked}`);
        } else {
          // sendTemplate returns null on rate-limit or error (already logged internally)
          skippedCount++;
        }
      } catch (clientErr) {
        console.error(`[weekly-checkin] Error processing ${masked}:`, clientErr.message);
        skippedCount++;
      }
    }

    console.log(`[weekly-checkin] Done: sent=${sentCount}, skipped=${skippedCount}`);
    return res.status(200).json({ success: true, sent_count: sentCount, skipped_count: skippedCount });
  } catch (err) {
    console.error('[weekly-checkin] Unhandled error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
