const { getSupabase } = require('../_lib/supabase');
const { sendMessage } = require('../_lib/whatsapp');
const { maskPhone } = require('../_lib/mask-phone');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const db = getSupabase();

    // Flow A step 3: Nudge leads who haven't replied in 2 hours (status=new)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: staleNewLeads } = await db.from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('last_msg_at', twentyFourHoursAgo);

    let nudged = 0;
    for (const lead of (staleNewLeads || [])) {
      await sendMessage(lead.phone, null, 'nudge_trial', false);
      nudged++;
      console.log(`Nudged: ${maskPhone(lead.phone)}`);
    }

    // Flow A step 4: Drop leads with no reply after 24 hours
    const { data: expiredLeads } = await db.from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lt('last_msg_at', twentyFourHoursAgo);

    let dropped = 0;
    for (const lead of (expiredLeads || [])) {
      await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
      dropped++;
    }

    // 7-day re-engagement for dropped leads (once only)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reengageLeads } = await db.from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo)
      .gt('last_msg_at', eightDaysAgo);

    let reengaged = 0;
    for (const lead of (reengageLeads || [])) {
      await sendMessage(lead.phone, null, 'reengage_7day', false);
      reengaged++;
    }

    console.log(`Nudge cron: nudged=${nudged}, dropped=${dropped}, reengaged=${reengaged}`);
    return res.status(200).json({ nudged, dropped, reengaged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
