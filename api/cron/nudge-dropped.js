const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { detectMarket, getLanguage } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getSupabase();

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: staleNew } = await db
      .from('leads')
      .select('id, phone, name, market')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    let nudged = 0;

    if (staleNew) {
      for (const lead of staleNew) {
        const lang = getLanguage(lead.market || detectMarket(lead.phone));
        if (lang === 'hinglish') {
          await sendWhatsApp(lead.phone, 'nudge_trial', [
            lead.name || 'there',
            'Ek $20 trial session se start karo — zero risk, full guidance!',
            'https://fitnessbymaddy.com/program-trial.html'
          ]);
        } else {
          await sendWhatsApp(lead.phone, 'nudge_trial', [
            lead.name || 'there',
            'Start with a $20 trial session — zero risk, full guidance!',
            'https://fitnessbymaddy.com/program-trial.html'
          ]);
        }
        nudged++;
      }
    }

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: expiredNew } = await db
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('last_msg_at', oneDayAgo);

    let dropped = 0;
    if (expiredNew) {
      for (const lead of expiredNew) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data: reEngageLeads } = await db
      .from('leads')
      .select('id, phone, name, market')
      .eq('status', 'dropped')
      .gt('created_at', fourteenDaysAgo)
      .lt('created_at', sevenDaysAgo);

    let reEngaged = 0;
    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        const { data: recentMsg } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .gt('sent_at', sevenDaysAgo)
          .limit(1);

        if (recentMsg && recentMsg.length > 0) continue;

        const lang = getLanguage(lead.market || detectMarket(lead.phone));
        if (lang === 'hinglish') {
          await sendWhatsApp(lead.phone, 'reengage_dropped', [
            lead.name || 'there',
            'Abhi bhi interest hai fitness mein? Maddy ki team ready hai help karne ke liye!'
          ]);
        } else {
          await sendWhatsApp(lead.phone, 'reengage_dropped', [
            lead.name || 'there',
            'Still interested in transforming your fitness? Maddy\'s team is here to help!'
          ]);
        }
        reEngaged++;
      }
    }

    return res.json({ action: 'nudge_complete', nudged, dropped, reEngaged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
