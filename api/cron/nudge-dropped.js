const { supabase } = require('../_lib/supabase');
const { sendWhatsApp, detectMarket } = require('../_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !isVercelCron(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();

    // Nudge leads that haven't replied after 2 hours (status=new, created 2-24hrs ago)
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

    const { data: staleLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo)
      .gte('created_at', twentyFourHoursAgo);

    let nudged = 0;
    if (staleLeads) {
      for (const lead of staleLeads) {
        const { count } = await supabase
          .from('messages')
          .select('*', { count: 'exact', head: true })
          .ilike('body', '%nudge_trial%')
          .eq('phone', lead.phone ? lead.phone.substring(0, 4) + 'XXX...' + lead.phone.slice(-3) : '');

        if ((count || 0) === 0) {
          const market = lead.market || detectMarket(lead.phone);
          const trialUrl = 'https://fitnessbymaddy.com/intake.html?program=trial';

          const params = market === 'IN'
            ? ['Hey! Maddy ka $20 trial try karo — 1 live Zoom session + full assessment. No commitment.', trialUrl]
            : ['Hey! Try Maddy\'s $20 trial — 1 live Zoom session + full assessment. No commitment.', trialUrl];

          await sendWhatsApp(lead.phone, 'nudge_trial', params);
          nudged++;
        }
      }
    }

    // Drop leads older than 24 hours with no reply
    const { data: deadLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lte('created_at', twentyFourHoursAgo);

    let dropped = 0;
    if (deadLeads && deadLeads.length > 0) {
      const ids = deadLeads.map(l => l.id);
      await supabase.from('leads').update({ status: 'dropped' }).in('id', ids);
      dropped = ids.length;
    }

    // Re-engage dropped leads (7-day rule): leads dropped 7 days ago, one final attempt
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reengageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lte('last_msg_at', sevenDaysAgo)
      .gte('last_msg_at', eightDaysAgo);

    let reengaged = 0;
    if (reengageLeads) {
      for (const lead of reengageLeads) {
        const market = lead.market || 'GLOBAL';
        const params = market === 'IN'
          ? ['Last chance! Maddy ke programs mein limited spots hai. Koi bhi sawaal ho toh bolo.']
          : ['Last chance! Limited spots in Maddy\'s programs. Reply if you have any questions.'];

        await sendWhatsApp(lead.phone, 'reengage_7day', params);
        reengaged++;
      }
    }

    return res.status(200).json({
      action: 'nudge_complete',
      nudged,
      dropped,
      reengaged,
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function isVercelCron(req) {
  return req.headers['x-vercel-cron'] === '1';
}
