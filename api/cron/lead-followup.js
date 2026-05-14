const { getSupabase } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');
const { isHinglish } = require('../_lib/market');
const { maskPhone } = require('../_lib/mask');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getSupabase();
    const now = Date.now();
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .eq('opted_out', false)
      .lt('last_msg_at', twoHoursAgo);

    if (!newLeads || newLeads.length === 0) {
      return res.status(200).json({ ok: true, nudged: 0, dropped: 0 });
    }

    let nudged = 0;
    let dropped = 0;

    for (const lead of newLeads) {
      const createdAt = new Date(lead.created_at).getTime();
      const hoursSinceCreation = (now - createdAt) / (1000 * 60 * 60);

      if (hoursSinceCreation >= 24) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
        console.log(`Dropped: ${maskPhone(lead.phone)} (no reply in 24hrs)`);
        continue;
      }

      const { data: outMessages } = await db
        .from('messages')
        .select('id, template_name')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .gte('sent_at', twoHoursAgo);

      if (outMessages && outMessages.length > 0) continue;

      const { data: nudgesSent } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 'nudge_trial')
        .eq('direction', 'out');

      if (nudgesSent && nudgesSent.length > 0) continue;

      const hinglish = isHinglish(lead.market);
      const trialLink = 'https://fitnessbymaddy.com';

      if (hinglish) {
        await sendTemplate(lead.phone, 'nudge_trial', [
          lead.name || 'there',
          trialLink
        ]);
      } else {
        await sendTemplate(lead.phone, 'nudge_trial', [
          lead.name || 'there',
          trialLink
        ]);
      }

      nudged++;
      console.log(`Nudge sent: ${maskPhone(lead.phone)}`);
    }

    return res.status(200).json({ ok: true, nudged, dropped });
  } catch (err) {
    console.error('Lead followup cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
