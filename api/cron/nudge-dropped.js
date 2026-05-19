const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const results = { reengaged: 0, skipped: 0 };

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ status: 'no_leads_to_nudge', results });
    }

    for (const lead of droppedLeads) {
      try {
        const { data: recentNudge } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'reengage_dropped')
          .gte('sent_at', fourteenDaysAgo)
          .limit(1);

        if (recentNudge && recentNudge.length > 0) {
          results.skipped++;
          continue;
        }

        await sendWhatsApp({
          phone: lead.phone,
          templateName: 'reengage_dropped',
          bodyValues: [
            lead.name || 'there',
            'https://fitnessbymaddy.com/shred.html',
          ],
        });

        results.reengaged++;
      } catch (err) {
        console.error(`Nudge error for lead ${lead.id}:`, err.message);
      }
    }

    return res.status(200).json({ status: 'ok', results });
  } catch (err) {
    console.error('Nudge-dropped cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
