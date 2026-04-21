const { supabase } = require('../../lib/supabase');
const { sendTemplate, canSendMessage } = require('../../lib/whatsapp');
const { sendJson, maskPhone, isHinglish } = require('../../lib/utils');

const NUDGE_WINDOW_DAYS = 7;
const NUDGE_COOLDOWN_HOURS = 48;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.SUPABASE_SERVICE_KEY}`;

  if (!isVercelCron && !isInternal && process.env.NODE_ENV === 'production') {
    return sendJson(res, 401, { error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - NUDGE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .eq('opted_out', false)
      .gte('created_at', sevenDaysAgo)
      .lte('last_msg_at', cutoff);

    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .eq('opted_out', false)
      .gte('created_at', sevenDaysAgo);

    const leads = [...(newLeads || []), ...(droppedLeads || [])];

    if (leads.length === 0) {
      return sendJson(res, 200, { message: 'No leads to nudge', nudged: 0 });
    }

    let nudged = 0;
    let skipped = 0;

    for (const lead of leads) {
      if (lead.opted_out) { skipped++; continue; }

      const allowed = await canSendMessage(lead.phone, false);
      if (!allowed) { skipped++; continue; }

      const { data: recentMessages } = await supabase
        .from('messages')
        .select('sent_at')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .gte('sent_at', new Date(Date.now() - NUDGE_COOLDOWN_HOURS * 60 * 60 * 1000).toISOString())
        .limit(1);

      if (recentMessages && recentMessages.length > 0) { skipped++; continue; }

      const hinglish = isHinglish(lead.market);
      const templateName = hinglish ? 'nudge_trial_hi' : 'nudge_trial_en';

      await sendTemplate(lead.phone, templateName, [
        lead.name || 'there',
        'https://fitnessbymaddy.com/program-trial.html',
      ]);

      if (lead.status === 'new') {
        const hoursSinceCreation = (Date.now() - new Date(lead.created_at).getTime()) / (60 * 60 * 1000);
        if (hoursSinceCreation > 24) {
          await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        }
      }

      console.log(`[NUDGE] Sent to ${maskPhone(lead.phone)}`);
      nudged++;
    }

    return sendJson(res, 200, {
      success: true,
      total_leads: leads.length,
      nudged,
      skipped,
    });
  } catch (err) {
    console.error('[CRON-NUDGE] Error:', err.message);
    return sendJson(res, 500, { error: 'Internal error' });
  }
};
