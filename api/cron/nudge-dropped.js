const { supabase } = require('../../lib/supabase');
const { sendTemplate, canSendMessage } = require('../../lib/whatsapp');

const REENGAGEMENT_WINDOW_DAYS = 7;

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - REENGAGEMENT_WINDOW_DAYS);

    const { data: newLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
      .gt('created_at', sevenDaysAgo.toISOString());

    const results = [];

    for (const lead of newLeads || []) {
      const allowed = await canSendMessage(lead.phone, false);
      if (!allowed) continue;

      const hoursSinceLastMsg = (Date.now() - new Date(lead.last_msg_at).getTime()) / (1000 * 60 * 60);

      if (hoursSinceLastMsg >= 2 && hoursSinceLastMsg < 24) {
        await sendTemplate(lead.phone, 'nudge_trial', [
          lead.name || 'there',
          'https://www.fitnessbymaddy.com/program-trial.html',
        ]);
        results.push({ phone: lead.phone, action: 'nudge_sent' });
      } else if (hoursSinceLastMsg >= 24) {
        await supabase
          .from('leads')
          .update({ status: 'dropped' })
          .eq('id', lead.id);
        results.push({ phone: lead.phone, action: 'marked_dropped' });
      }
    }

    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gt('created_at', sevenDaysAgo.toISOString());

    for (const lead of droppedLeads || []) {
      const daysSinceCreated = (Date.now() - new Date(lead.created_at).getTime()) / (1000 * 60 * 60 * 24);

      if (daysSinceCreated >= 3 && daysSinceCreated < 4) {
        const allowed = await canSendMessage(lead.phone, false);
        if (!allowed) continue;

        await sendTemplate(lead.phone, 'reengage_dropped', [
          lead.name || 'there',
        ]);
        results.push({ phone: lead.phone, action: 'reengagement_sent' });
      }
    }

    const { data: pendingCheckins } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    for (const client of pendingCheckins || []) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((Date.now() - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      const { data: checkin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (checkin) continue;

      const dayOfWeek = new Date().getDay();
      if (dayOfWeek === 1 || dayOfWeek === 2) {
        const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;
        await sendTemplate(client.phone, 'checkin_reminder', [
          client.name || 'there',
          checkinUrl,
        ]);
        results.push({ client_id: client.id, action: 'checkin_nudge' });
      }
    }

    return res.status(200).json({ processed: results.length, details: results });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
