const { getSupabase } = require('../_lib/supabase');
const { sendTemplate, detectMarket } = require('../_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !process.env.VERCEL_URL) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const db = getSupabase();

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const { data: leads } = await db
    .from('leads')
    .select('id, phone, name, market, program_interest')
    .eq('status', 'new')
    .gte('created_at', fourteenDaysAgo)
    .lte('last_msg_at', sevenDaysAgo);

  if (!leads || leads.length === 0) {
    return res.json({ ok: true, nudged: 0 });
  }

  let nudged = 0;

  for (const lead of leads) {
    const market = lead.market || detectMarket(lead.phone);

    const msg = market === 'IN'
      ? [`Hey ${lead.name || 'there'}! Maddy ka $20 trial session abhi available hai — pehle try karo, phir decide karo 💪\n\nhttps://fitnessbymaddy.com/program-trial.html`]
      : [`Hey ${lead.name || 'there'}! Maddy's $20 trial session is still available — try before you commit 💪\n\nhttps://fitnessbymaddy.com/program-trial.html`];

    await sendTemplate(lead.phone, 'nudge_trial', msg);

    await db.from('leads').update({
      status: 'dropped',
      last_msg_at: new Date().toISOString()
    }).eq('id', lead.id);

    nudged++;
  }

  return res.json({ ok: true, nudged });
};
