const { supabase } = require('../_lib/supabase');
const { sendTemplate, maskPhone } = require('../_lib/whatsapp');

/**
 * Daily cron — re-engages dropped leads using the 7-day rule.
 * Targets leads that were dropped 7-14 days ago and haven't been
 * re-engaged yet.
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
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();

    // Query dropped leads updated 7-14 days ago, not yet re-engaged
    const { data: leads, error: leadsErr } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('updated_at', fourteenDaysAgo)
      .lte('updated_at', sevenDaysAgo)
      .is('reengaged_at', null);

    if (leadsErr) {
      console.error('[nudge-dropped] Failed to fetch leads:', leadsErr.message);
      return res.status(500).json({ error: 'Failed to fetch leads' });
    }

    if (!leads || leads.length === 0) {
      return res.status(200).json({ ...summary, message: 'No leads to re-engage' });
    }

    for (const lead of leads) {
      summary.processed++;

      try {
        const result = await sendTemplate(lead.phone, 'reengagement_v1', {
          name: lead.name,
          templateParams: [lead.name],
        });

        if (result.success) {
          console.log(`[nudge-dropped] Re-engagement sent to ${maskPhone(lead.phone)}`);

          // Mark with reengaged_at to prevent double-sending
          await supabase
            .from('leads')
            .update({ reengaged_at: new Date().toISOString() })
            .eq('id', lead.id);

          await supabase.from('nudge_log').insert({
            phone: lead.phone,
            nudge_type: 'reengagement',
            sent_at: new Date().toISOString(),
          });

          summary.sent++;
        } else {
          console.error(`[nudge-dropped] Failed to send to ${maskPhone(lead.phone)}`);
          summary.skipped++;
        }
      } catch (leadErr) {
        console.error(`[nudge-dropped] Error processing lead ${lead.id}:`, leadErr.message);
        summary.errors.push({ lead_id: lead.id, error: leadErr.message });
      }
    }

    console.log(`[nudge-dropped] Done — processed: ${summary.processed}, sent: ${summary.sent}, skipped: ${summary.skipped}`);
    return res.status(200).json(summary);
  } catch (err) {
    console.error('[nudge-dropped] Unexpected error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
