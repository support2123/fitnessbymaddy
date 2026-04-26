const { supabase } = require('../../lib/supabase');
const { sendTemplate, canSendMessage } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeadsToNudge } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
      .gt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    let nudgedNew = 0;
    for (const lead of newLeadsToNudge || []) {
      const allowed = await canSendMessage(lead.phone);
      if (!allowed) continue;

      await sendTemplate(lead.phone, 'nudge_trial', [lead.name || 'there']);
      nudgedNew++;
    }

    const { data: droppedToReengage } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    let reengaged = 0;
    for (const lead of droppedToReengage || []) {
      const allowed = await canSendMessage(lead.phone);
      if (!allowed) continue;

      const { data: alreadySent } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 'reengage_v1')
        .gte('sent_at', fourteenDaysAgo)
        .limit(1);

      if (alreadySent && alreadySent.length > 0) continue;

      const templateName = isHinglish(lead.market) ? 'reengage_v1' : 'reengage_v1_en';
      await sendTemplate(lead.phone, templateName, [lead.name || 'there']);
      reengaged++;
    }

    const { data: expiredLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('last_msg_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    if (expiredLeads && expiredLeads.length > 0) {
      const ids = expiredLeads.map(l => l.id);
      await supabase.from('leads')
        .update({ status: 'dropped' })
        .in('id', ids);
    }

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: pendingCheckins } = await supabase
      .from('checkins')
      .select('client_id, week_no, created_at')
      .is('form_submitted_at', null);

    let checkinNudges = 0;
    for (const checkin of pendingCheckins || []) {
      const createdAt = new Date(checkin.created_at);
      const hoursSinceCreated = (Date.now() - createdAt) / (1000 * 60 * 60);

      if (hoursSinceCreated >= 24 && hoursSinceCreated < 26) {
        const { data: client } = await supabase
          .from('clients')
          .select('phone, name')
          .eq('id', checkin.client_id)
          .maybeSingle();

        if (client) {
          const allowed = await canSendMessage(client.phone);
          if (allowed) {
            await sendTemplate(client.phone, 'checkin_reminder', [
              client.name || 'there',
              String(checkin.week_no)
            ]);
            checkinNudges++;
          }
        }
      }

      if (hoursSinceCreated >= 48 && hoursSinceCreated < 50) {
        const { data: client } = await supabase
          .from('clients')
          .select('phone, name')
          .eq('id', checkin.client_id)
          .maybeSingle();

        if (client) {
          const allowed = await canSendMessage(client.phone);
          if (allowed) {
            await sendTemplate(client.phone, 'checkin_reminder_final', [
              client.name || 'there',
              String(checkin.week_no)
            ]);
            checkinNudges++;
          }
        }
      }
    }

    return res.status(200).json({
      success: true,
      nudged_new: nudgedNew,
      reengaged,
      expired: expiredLeads?.length || 0,
      checkin_nudges: checkinNudges
    });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
