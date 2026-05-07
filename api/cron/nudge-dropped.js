const { supabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { detectMarket, isHinglish } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: leads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('last_msg_at', sevenDaysAgo)
      .gte('last_msg_at', fourteenDaysAgo);

    let sent = 0;

    for (const lead of leads || []) {
      const { count } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'nudge_trial');

      if (count && count > 0) continue;

      const market = detectMarket(lead.phone);
      const msg = isHinglish(market)
        ? `Hey ${lead.name || ''}! 👋 Maddy ke saath ek $20 trial session try karo — bas ek session mein feel karoge difference!\n\nBook karo: https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial\n\nLimited spots available! ⏰`
        : `Hey ${lead.name || ''}! 👋 Try a $20 trial session with Maddy — feel the difference in just one session!\n\nBook here: https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial\n\nLimited spots available! ⏰`;

      await sendWhatsApp(lead.phone, msg, 'nudge_trial', true);
      sent++;
    }

    // Also nudge leads who received welcome but didn't reply (2hr mark)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();

    const { data: freshLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo)
      .gte('created_at', fourHoursAgo);

    for (const lead of freshLeads || []) {
      const { data: replies } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gt('sent_at', lead.created_at)
        .limit(1);

      if (replies && replies.length > 0) continue;

      const { count } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('template_name', 'nudge_2hr');

      if (count && count > 0) continue;

      const market = detectMarket(lead.phone);
      const msg = isHinglish(market)
        ? `Ek quick trial se start karo! 💪 Sirf $20 mein Maddy ke saath Zoom session.\n\nBook karo: https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial`
        : `Start with a quick trial! 💪 Just $20 for a Zoom session with Maddy.\n\nBook here: https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial`;

      await sendWhatsApp(lead.phone, msg, 'nudge_2hr', true);
      sent++;
    }

    // Mark 24hr+ no-reply leads as dropped
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: staleLeads } = await supabase
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lte('created_at', oneDayAgo);

    let dropped = 0;
    for (const lead of staleLeads || []) {
      const { data: replies } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .limit(2);

      // Only drop if they never replied beyond the first message
      if (!replies || replies.length <= 1) {
        await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    return res.status(200).json({ nudged: sent, dropped });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
