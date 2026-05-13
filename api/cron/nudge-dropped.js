const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/mask-phone');

const RE_ENGAGE_MSG =
  "Hey! We noticed you were interested in fitness coaching. " +
  "Maddy has a $20 trial session — want to give it a shot? " +
  "Reply YES to learn more.";

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getSupabase();
  const summary = { eligible: 0, sent: 0 };

  try {
    const now = new Date();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString();

    // 1. Find dropped leads created between 7 and 14 days ago
    const { data: leads, error: fetchErr } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('created_at', fourteenDaysAgo)
      .lte('created_at', sevenDaysAgo);

    if (fetchErr) {
      console.error('Failed to fetch dropped leads:', fetchErr.message);
      return res.status(500).json({ error: 'Failed to fetch leads' });
    }

    if (!leads || leads.length === 0) {
      console.log('No eligible dropped leads found');
      return res.status(200).json({ ok: true, ...summary });
    }

    for (const lead of leads) {
      // 2. Check they haven't been messaged in last 7 days
      const { data: recentMessages } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .gte('sent_at', sevenDaysAgo)
        .limit(1);

      if (recentMessages && recentMessages.length > 0) {
        console.log(`Lead ${maskPhone(lead.phone)} was messaged recently, skipping`);
        continue;
      }

      summary.eligible++;

      // 3. Send re-engagement message (don't change status)
      const result = await sendWhatsApp(lead.phone, RE_ENGAGE_MSG, 'nudge_dropped');
      if (result.ok) {
        summary.sent++;
        console.log(`Nudge sent to ${maskPhone(lead.phone)}`);
      } else {
        console.log(`Failed to nudge ${maskPhone(lead.phone)}: ${result.reason || 'unknown'}`);
      }
    }

    console.log(`Nudge-dropped cron complete: ${JSON.stringify(summary)}`);
    return res.status(200).json({ ok: true, ...summary });
  } catch (err) {
    console.error('nudge-dropped cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
