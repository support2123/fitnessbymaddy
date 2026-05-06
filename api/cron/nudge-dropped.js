const { getSupabase } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');
const { maskPhone, isHinglish, detectMarket } = require('../_lib/helpers');

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    if (req.headers['x-vercel-cron'] !== '1' && !process.env.VERCEL) {
      return res.status(401).json({ error: 'unauthorized' });
    }
  }

  try {
    const supabase = getSupabase();

    const now = new Date();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: leads } = await supabase
      .from('leads')
      .select('*')
      .in('status', ['new', 'qualified'])
      .lte('last_msg_at', sevenDaysAgo)
      .gte('last_msg_at', fourteenDaysAgo);

    if (!leads?.length) {
      return res.status(200).json({ message: 'no leads to nudge', sent: 0 });
    }

    let sent = 0;

    for (const lead of leads) {
      try {
        const { count } = await supabase
          .from('messages')
          .select('*', { count: 'exact', head: true })
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'nudge_trial');

        if ((count || 0) >= 2) continue;

        const market = lead.market || detectMarket(lead.phone);

        const params = isHinglish(market)
          ? [lead.name || 'there', 'https://fitnessbymaddy.com/shred.html']
          : [lead.name || 'there', 'https://fitnessbymaddy.com/shred.html'];

        await sendTemplate(lead.phone, 'nudge_trial', params);
        sent++;
      } catch (err) {
        console.error(`[NUDGE] Error for ${maskPhone(lead.phone)}:`, err.message);
      }
    }

    const { data: staleLeads } = await supabase
      .from('leads')
      .select('id')
      .in('status', ['new', 'qualified'])
      .lte('last_msg_at', fourteenDaysAgo);

    if (staleLeads?.length) {
      const staleIds = staleLeads.map(l => l.id);
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .in('id', staleIds);
    }

    console.log(`[CRON nudge-dropped] Sent: ${sent}, Stale dropped: ${staleLeads?.length || 0}`);
    return res.status(200).json({ sent, stale_dropped: staleLeads?.length || 0 });
  } catch (err) {
    console.error('[CRON nudge-dropped ERROR]', err.message);
    return res.status(500).json({ error: 'internal_error' });
  }
};
