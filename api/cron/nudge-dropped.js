const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sb = getSupabase();

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: leads } = await sb
      .from('leads')
      .select('id, phone, name, market, last_msg_at')
      .eq('status', 'new')
      .gte('created_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!leads || leads.length === 0) {
      return res.status(200).json({ nudged: 0 });
    }

    let nudged = 0;
    for (const lead of leads) {
      const trialUrl = 'https://www.fitnessbymaddy.com/shred.html';
      const params = lead.market === 'IN'
        ? [`Hey ${lead.name || 'there'}! Maddy ke $20 trial se start karo — koi commitment nahi. 💪\n\n${trialUrl}`]
        : [`Hey ${lead.name || 'there'}! Start with Maddy's $20 trial — no commitment needed. 💪\n\n${trialUrl}`];

      const result = await sendWhatsApp(lead.phone, 'nudge_trial', params);

      if (result.ok) {
        await sb.from('leads')
          .update({ last_msg_at: new Date().toISOString() })
          .eq('id', lead.id);
        nudged++;
      }
    }

    return res.status(200).json({ ok: true, nudged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
