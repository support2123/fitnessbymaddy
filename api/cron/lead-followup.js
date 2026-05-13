const { getSupabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { isHinglish, detectMarket } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const now = new Date();

  // Get new leads that haven't been nudged yet
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  // 2-hour nudge: leads with nudge_count=0, created > 2hrs ago
  const { data: nudgeLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .eq('nudge_count', 0)
    .lte('created_at', twoHoursAgo);

  let nudged = 0;
  for (const lead of (nudgeLeads || [])) {
    const trialUrl = 'https://fitnessbymaddy.com/program-trial.html';
    await sendTemplate(lead.phone, 'nudge_trial', [
      lead.name || 'there',
      trialUrl
    ]);
    await db.from('leads').update({ nudge_count: 1 }).eq('id', lead.id);
    nudged++;
  }

  // 24-hour drop: leads with nudge_count >= 1, created > 24hrs ago, still status=new
  const { data: dropLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .gte('nudge_count', 1)
    .lte('created_at', twentyFourHoursAgo);

  let dropped = 0;
  for (const lead of (dropLeads || [])) {
    await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
    dropped++;
  }

  return res.status(200).json({ nudged, dropped });
};
