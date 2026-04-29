const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { maskPhone } = require('../../lib/phone');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ message: 'No leads to re-engage', count: 0 });
    }

    const { data: alreadyNudged } = await db
      .from('messages')
      .select('phone')
      .eq('template_name', 'win_back')
      .gte('sent_at', fourteenDaysAgo);

    const nudgedPhones = new Set((alreadyNudged || []).map(m => m.phone));

    let sent = 0;
    for (const lead of droppedLeads) {
      if (nudgedPhones.has(lead.phone)) continue;

      try {
        const isIN = lead.market === 'IN';
        await sendWhatsApp({
          phone: lead.phone,
          templateName: 'win_back',
          params: [
            lead.name || 'there',
            isIN ? 'Abhi bhi interested ho toh $20 trial try karo — no commitment!' : 'Still interested? Try our $20 trial — no commitment!'
          ]
        });
        sent++;
      } catch (e) {
        console.error(`Win-back error for ${maskPhone(lead.phone)}:`, e.message);
      }
    }

    console.log(`Nudge-dropped cron: ${sent} re-engagement messages sent`);
    return res.status(200).json({ ok: true, sent });

  } catch (err) {
    console.error('Nudge-dropped cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
