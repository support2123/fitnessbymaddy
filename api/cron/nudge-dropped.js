const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { json } = require('../../lib/utils');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return json(res, { error: 'Unauthorized' }, 401);
  }

  const db = getSupabase();

  try {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    // Find leads that were dropped 7 days ago but not older than 14 days
    // (one-time re-engagement, not spam)
    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', fourteenDaysAgo.toISOString())
      .lte('last_msg_at', sevenDaysAgo.toISOString());

    if (!droppedLeads || droppedLeads.length === 0) {
      return json(res, { message: 'No leads to re-engage', sent: 0 });
    }

    let sent = 0;

    for (const lead of droppedLeads) {
      // Check we haven't already sent a re-engagement
      const { data: recentOut } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 'reengage_7day')
        .limit(1)
        .single();

      if (recentOut) continue;

      const market = lead.market || 'IN';
      await sendWhatsApp({
        phone: lead.phone,
        templateName: 'reengage_7day',
        params: [lead.name || 'there'],
      });

      sent++;
    }

    // Also nudge active clients who haven't submitted their check-in
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);

    const { data: pendingCheckins } = await db
      .from('checkins')
      .select('*, clients!inner(phone, name, status)')
      .is('form_submitted_at', null)
      .gte('created_at', twoDaysAgo.toISOString())
      .lte('created_at', oneDayAgo.toISOString());

    let nudged = 0;

    if (pendingCheckins) {
      for (const checkin of pendingCheckins) {
        if (checkin.clients.status !== 'active') continue;

        await sendWhatsApp({
          phone: checkin.clients.phone,
          templateName: 'checkin_reminder',
          params: [
            checkin.clients.name || 'there',
            String(checkin.week_no),
            `https://fitnessbymaddy.com/checkin?c=${checkin.client_id}&w=${checkin.week_no}`,
          ],
        });

        nudged++;
      }
    }

    return json(res, { reengaged: sent, nudged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return json(res, { error: 'Internal error' }, 500);
  }
};
