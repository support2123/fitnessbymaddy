const { getSupabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  try {
    const db = getSupabase();

    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const eightDaysAgo = new Date(Date.now() - 8 * 86400000).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', eightDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ message: 'No leads to nudge', sent: 0 });
    }

    let sent = 0;
    const errors = [];

    for (const lead of droppedLeads) {
      try {
        const { data: optOutMsg } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .ilike('body', '%stop%')
          .limit(1);

        if (optOutMsg && optOutMsg.length > 0) continue;

        const hinglish = isHinglish(lead.market);
        const templateName = hinglish ? 'nudge_reactivate_hi' : 'nudge_reactivate_en';

        await sendTemplate(lead.phone, templateName, [
          lead.name || 'there'
        ]);

        sent++;
      } catch (leadErr) {
        errors.push({ lead_id: lead.id, error: leadErr.message });
      }
    }

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: noReplyLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo)
      .gte('created_at', new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString());

    if (noReplyLeads && noReplyLeads.length > 0) {
      for (const lead of noReplyLeads) {
        try {
          const hinglish = isHinglish(lead.market);
          const templateName = hinglish ? 'nudge_trial' : 'nudge_trial_en';
          await sendTemplate(lead.phone, templateName, [
            lead.name || 'there',
            'https://www.fitnessbymaddy.com/program-trial.html'
          ]);
          sent++;
        } catch (e) {
          errors.push({ lead_id: lead.id, error: e.message });
        }
      }
    }

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const oneDayPlusHour = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const { data: staleLeads } = await db
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lte('created_at', oneDayAgo)
      .gte('created_at', oneDayPlusHour);

    if (staleLeads && staleLeads.length > 0) {
      const ids = staleLeads.map(l => l.id);
      await db.from('leads').update({ status: 'dropped' }).in('id', ids);
    }

    return res.status(200).json({
      message: 'Nudge cron complete',
      sent,
      dropped: staleLeads ? staleLeads.length : 0,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
