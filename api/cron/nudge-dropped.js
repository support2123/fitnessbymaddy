const { getSupabase } = require('../lib/supabase');
const { canSendMessage, sendTemplate } = require('../lib/whatsapp');
const { isHinglish } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !isVercelCron(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: nudgeLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo)
      .gte('created_at', twentyFourHoursAgo);

    let nudged = 0;
    if (nudgeLeads) {
      for (const lead of nudgeLeads) {
        const allowed = await canSendMessage(lead.phone, false);
        if (!allowed) continue;

        const market = lead.market || 'GLOBAL';
        await sendTemplate(lead.phone, 'nudge_trial', [
          lead.name || 'there',
          'https://www.fitnessbymaddy.com/program-trial.html',
        ]);
        nudged++;
      }
    }

    const { data: dropLeads } = await db
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lte('created_at', twentyFourHoursAgo);

    let dropped = 0;
    if (dropLeads) {
      for (const lead of dropLeads) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reEngageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lte('last_msg_at', sevenDaysAgo)
      .gte('last_msg_at', fourteenDaysAgo);

    let reEngaged = 0;
    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        const allowed = await canSendMessage(lead.phone, false);
        if (!allowed) continue;

        await sendTemplate(lead.phone, 'reengage_v1', [
          lead.name || 'there',
        ]);
        reEngaged++;
      }
    }

    return res.status(200).json({ ok: true, nudged, dropped, reEngaged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function isVercelCron(req) {
  return req.headers['x-vercel-cron'] === '1';
}
