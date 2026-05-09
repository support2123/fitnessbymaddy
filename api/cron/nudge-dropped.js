const { getSupabase } = require('../lib/supabase');
const { sendTemplate, maskPhone } = require('../lib/whatsapp');
const { canSendToLead, logMessage } = require('../lib/rate-limit');

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabase = getSupabase();

    const sevenDaysAgo = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 2 * SEVEN_DAYS_MS).toISOString();

    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('id, phone, name, market, last_msg_at')
      .eq('status', 'dropped')
      .lte('last_msg_at', sevenDaysAgo)
      .gte('last_msg_at', fourteenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ message: 'No leads to nudge', sent: 0 });
    }

    let sent = 0;

    for (const lead of droppedLeads) {
      try {
        const allowed = await canSendToLead(lead.phone);
        if (!allowed) continue;

        await sendTemplate(lead.phone, 'nudge_trial', [
          lead.name || 'there',
        ]);
        await logMessage(lead.phone, 'out', 'Re-engagement nudge', 'nudge_trial');

        await supabase
          .from('leads')
          .update({
            status: 'new',
            last_msg_at: new Date().toISOString(),
          })
          .eq('id', lead.id);

        sent++;
      } catch (err) {
        console.error(`Nudge failed for ${maskPhone(lead.phone)}:`, err.message);
      }
    }

    return res.status(200).json({ sent, total: droppedLeads.length });
  } catch (err) {
    console.error('Nudge cron error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
