import { supabase } from '../lib/supabase.js';
import { sendTemplate } from '../lib/whatsapp.js';
import { canSendMessage, logMessage } from '../lib/rate-limit.js';

export const config = { cron: '0 5 * * *' }; // Daily 10:30 AM IST (5:00 UTC)

export default async function handler(req, res) {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: leads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!leads || leads.length === 0) {
      return res.status(200).json({ status: 'no_leads_to_nudge' });
    }

    const results = [];

    for (const lead of leads) {
      const canSend = await canSendMessage(lead.phone);
      if (!canSend) {
        results.push({ lead_id: lead.id, status: 'rate_limited' });
        continue;
      }

      await sendTemplate(lead.phone, 'nudge_trial', [lead.name || 'there']);
      await logMessage(lead.phone, 'out', 'Re-engagement nudge', 'nudge_trial');

      results.push({ lead_id: lead.id, status: 'nudged' });
    }

    return res.status(200).json({ status: 'done', nudged: results.length, results });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
