const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, canSendMessage } = require('../../lib/whatsapp');
const { isHinglish, detectMarket, maskPhone } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;
  if (!isCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const { data: newLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo);

    let nudged = 0;

    if (newLeads) {
      for (const lead of newLeads) {
        const hoursSinceLastMsg = (now.getTime() - new Date(lead.last_msg_at).getTime()) / (60 * 60 * 1000);

        if (hoursSinceLastMsg >= 24) {
          await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
          continue;
        }

        if (hoursSinceLastMsg >= 2 && await canSendMessage(lead.phone, false)) {
          const market = detectMarket(lead.phone);
          const templateName = isHinglish(market) ? 'nudge_trial_hi' : 'nudge_trial_en';
          try {
            await sendTemplate(lead.phone, templateName, [
              lead.name || 'there',
              'https://fitnessbymaddy.com/program-trial.html',
            ], lead.name);
            nudged++;
          } catch (err) {
            console.error('Nudge failed for', maskPhone(lead.phone), err.message);
          }
        }
      }
    }

    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    let reengaged = 0;

    if (droppedLeads) {
      for (const lead of droppedLeads) {
        if (await canSendMessage(lead.phone, false)) {
          const market = detectMarket(lead.phone);
          const templateName = isHinglish(market) ? 'reengage_hi' : 'reengage_en';
          try {
            await sendTemplate(lead.phone, templateName, [
              lead.name || 'there',
            ], lead.name);
            reengaged++;
          } catch (err) {
            console.error('Re-engage failed for', maskPhone(lead.phone), err.message);
          }
        }
      }
    }

    return res.status(200).json({ nudged, reengaged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
