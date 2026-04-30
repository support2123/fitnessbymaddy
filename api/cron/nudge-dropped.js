const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, canSendMessage, maskPhone } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');
const { detectMarket } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}` &&
      req.headers['authorization'] !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const twoDaysAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('last_msg_at', twoDaysAgo);

    let nudged = 0;
    let dropped = 0;

    if (newLeads) {
      for (const lead of newLeads) {
        const hoursSinceLastMsg = (Date.now() - new Date(lead.last_msg_at).getTime()) / 3600000;

        if (hoursSinceLastMsg >= 24) {
          await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
          dropped++;
          continue;
        }

        if (hoursSinceLastMsg >= 2) {
          const rateOk = await canSendMessage(lead.phone);
          if (rateOk) {
            await sendTemplate(lead.phone, 'nudge_trial', [
              lead.name || 'there',
              '$20',
              'https://www.fitnessbymaddy.com/program-trial.html'
            ]);
            nudged++;
          }
        }
      }
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString();

    const { data: reengageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    let reengaged = 0;

    if (reengageLeads) {
      for (const lead of reengageLeads) {
        const { data: recentMsg } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .gte('sent_at', sevenDaysAgo)
          .limit(1);

        if (recentMsg && recentMsg.length > 0) continue;

        const hinglish = isHinglish(detectMarket(lead.phone));
        const templateName = hinglish ? 'reengage_hinglish' : 'reengage_english';

        await sendTemplate(lead.phone, templateName, [
          lead.name || 'there'
        ]);
        reengaged++;
      }
    }

    console.log(`Nudge cron: nudged=${nudged}, dropped=${dropped}, reengaged=${reengaged}`);
    return res.status(200).json({ success: true, nudged, dropped, reengaged });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
