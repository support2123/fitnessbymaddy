const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    // Nudge leads with no reply after 2 hours (still new)
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .eq('opted_out', false)
      .lt('created_at', twoHoursAgo)
      .gt('created_at', twentyFourHoursAgo);

    let nudged = 0;

    if (newLeads) {
      for (const lead of newLeads) {
        const { data: outbound } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .gte('sent_at', twoHoursAgo)
          .limit(1);

        if (outbound && outbound.length > 0) continue;

        const { data: replies } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .gt('sent_at', lead.created_at)
          .limit(1);

        if (replies && replies.length > 1) continue;

        const market = lead.market || 'IN';
        const msg = market === 'IN'
          ? 'Hey! Maddy ke $20 trial session try karo — 1 live Zoom call + assessment.\n\nhttps://fitnessbymaddy.com/program-trial.html\n\nKoi commitment nahi, just try karo!'
          : 'Hey! Try Maddy\'s $20 trial session — 1 live Zoom call + full assessment.\n\nhttps://fitnessbymaddy.com/program-trial.html\n\nNo commitment, just see if it\'s right for you!';

        await sendWhatsApp(lead.phone, msg, 'nudge_trial');
        nudged++;
      }
    }

    // Drop leads older than 24 hours with no reply
    const { data: staleLeads } = await db
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .eq('opted_out', false)
      .lt('created_at', twentyFourHoursAgo);

    let dropped = 0;

    if (staleLeads) {
      for (const lead of staleLeads) {
        const { data: replies } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .limit(2);

        if (replies && replies.length <= 1) {
          await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
          dropped++;
        }
      }
    }

    // Re-engage dropped leads (7-day rule) — only once
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reengageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .eq('opted_out', false)
      .lt('last_msg_at', sevenDaysAgo)
      .gt('last_msg_at', eightDaysAgo);

    let reengaged = 0;

    if (reengageLeads) {
      for (const lead of reengageLeads) {
        const market = lead.market || 'IN';
        const msg = market === 'IN'
          ? 'Hey! Maddy ne new programs launch kiye hain. PCOS Warrior ($45) aur 40+ Strong ($50). Interested?\n\nYa phir $20 trial se start karo: https://fitnessbymaddy.com/program-trial.html'
          : 'Hey! Maddy just launched new programs — PCOS Warrior ($45) and 40+ Strong ($50). Interested?\n\nOr start with a $20 trial: https://fitnessbymaddy.com/program-trial.html';

        await sendWhatsApp(lead.phone, msg);
        reengaged++;
      }
    }

    return res.status(200).json({ ok: true, nudged, dropped, reengaged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
