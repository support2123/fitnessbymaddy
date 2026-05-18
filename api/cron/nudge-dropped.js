const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { json, detectMarket } = require('../../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return json(res, { error: 'Method not allowed' }, 405);
  }

  const authHeader = req.headers['authorization'];
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;

  if (!isVercelCron && !isInternal && req.method === 'GET') {
    return json(res, { error: 'Unauthorized' }, 401);
  }

  const db = getSupabase();

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return json(res, { message: 'No leads to re-engage', sent: 0 });
    }

    const { data: recentNudges } = await db
      .from('messages')
      .select('phone')
      .eq('direction', 'out')
      .eq('template_name', 'reengagement')
      .gte('sent_at', sevenDaysAgo);

    const nudgedPhones = new Set((recentNudges || []).map(n => n.phone));

    let sent = 0;

    for (const lead of droppedLeads) {
      if (nudgedPhones.has(lead.phone)) continue;

      const market = detectMarket(lead.phone);
      const templateName = market === 'IN' ? 'reengagement_hinglish' : 'reengagement';

      await sendWhatsApp(lead.phone, templateName, {
        name: lead.name || 'there',
        templateParams: [lead.name || 'there'],
        body: market === 'IN'
          ? 'Hey! Maddy ka $20 trial session available hai — sirf 1 hour mein apna plan pata karo. Interest ho toh "TRIAL" reply karo!'
          : "Hey! Maddy's $20 trial session is available — get your personalized plan in just 1 hour. Reply 'TRIAL' if interested!"
      });
      sent++;
    }

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const { data: pendingCheckins } = await db
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    let checkinNudges = 0;

    if (pendingCheckins) {
      for (const client of pendingCheckins) {
        const start = new Date(client.program_started_at);
        const weekNo = Math.max(1, Math.ceil((Date.now() - start) / (7 * 24 * 60 * 60 * 1000)));

        const { data: checkin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .maybeSingle();

        if (checkin) continue;

        const { data: lastMsg } = await db
          .from('messages')
          .select('sent_at, template_name')
          .eq('phone', client.phone)
          .eq('direction', 'out')
          .in('template_name', ['weekly_checkin', 'weekly_checkin_hinglish', 'checkin_nudge'])
          .order('sent_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!lastMsg) continue;

        const lastSent = new Date(lastMsg.sent_at);
        const hoursSince = (Date.now() - lastSent) / (60 * 60 * 1000);

        if (hoursSince >= 24 && hoursSince < 72) {
          const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
          await sendWhatsApp(client.phone, 'checkin_nudge', {
            name: client.name || 'there',
            templateParams: [client.name || 'there', String(weekNo), checkinUrl],
            body: `Reminder: Your Week ${weekNo} check-in is pending! ${checkinUrl}`
          });
          checkinNudges++;
        }
      }
    }

    return json(res, { success: true, reengaged: sent, checkin_nudges: checkinNudges });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return json(res, { error: 'Internal error' }, 500);
  }
};
