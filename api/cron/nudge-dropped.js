const { supabase } = require('../lib/supabase');
const { sendTemplate, canSendMessage } = require('../lib/whatsapp');
const { json } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return json(res, 405, { error: 'GET or POST only' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return json(res, 401, { error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeadsToNudge } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', twentyFourHoursAgo);

    let nudgesSent = 0;

    if (newLeadsToNudge) {
      for (const lead of newLeadsToNudge) {
        const { data: outMessages } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'nudge_trial')
          .limit(1);

        if (outMessages && outMessages.length > 0) continue;

        if (await canSendMessage(lead.phone)) {
          await sendTemplate(lead.phone, 'nudge_trial', [
            lead.name || 'there'
          ]);
          nudgesSent++;
        }
      }
    }

    const { data: staleLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('created_at', twentyFourHoursAgo);

    let droppedCount = 0;
    if (staleLeads) {
      for (const lead of staleLeads) {
        await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        droppedCount++;
      }
    }

    const { data: reEngageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gt('created_at', sevenDaysAgo);

    let reEngaged = 0;
    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        const { data: reEngageMessages } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'reengage_7day')
          .limit(1);

        if (reEngageMessages && reEngageMessages.length > 0) continue;

        const daysSinceDrop = Math.floor(
          (now - new Date(lead.last_msg_at || lead.created_at)) / (1000 * 60 * 60 * 24)
        );
        if (daysSinceDrop < 6 || daysSinceDrop > 8) continue;

        if (await canSendMessage(lead.phone)) {
          await sendTemplate(lead.phone, 'reengage_7day', [
            lead.name || 'there'
          ]);
          reEngaged++;
        }
      }
    }

    return json(res, 200, {
      ok: true,
      nudges_sent: nudgesSent,
      dropped: droppedCount,
      re_engaged: reEngaged
    });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return json(res, 500, { error: 'Cron failed' });
  }
};
