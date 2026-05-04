const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { detectMarket, isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}` && req.method !== 'GET') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabase = getSupabase();

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('created_at', eightDaysAgo)
      .lte('created_at', sevenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ ok: true, nudged: 0 });
    }

    let nudged = 0;

    for (const lead of droppedLeads) {
      try {
        const { count } = await supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .ilike('phone', `%${lead.phone.slice(-3)}`)
          .eq('direction', 'out')
          .eq('template_name', 'reengagement_7day');

        if (count && count > 0) continue;

        const market = lead.market || detectMarket(lead.phone);
        const hinglish = isHinglish(market);

        const msg = hinglish
          ? `Hey ${lead.name || 'there'}! Maddy ke programs mein limited spots hain. Koi bhi doubt ho toh pooch — hum help karenge. Trial sirf $20 mein start kar sakti hai 💪`
          : `Hey ${lead.name || 'there'}! Limited spots in Maddy's programs. Any doubts? We're here to help. Start with a $20 trial 💪`;

        await sendWhatsApp(lead.phone, 'reengagement_7day', [
          lead.name || 'there',
          msg,
        ]);

        nudged++;
      } catch (e) {
        console.error(`Nudge error for lead ${lead.id}:`, e.message);
      }
    }

    return res.status(200).json({ ok: true, nudged });
  } catch (err) {
    console.error('Nudge dropped cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
