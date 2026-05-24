const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, detectMarket, canSendMessage } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;

  if (!isVercelCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await db.from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo)
      .gte('created_at', twentyFourHoursAgo);

    let nudged = 0;

    if (newLeads) {
      for (const lead of newLeads) {
        const allowed = await canSendMessage(lead.phone);
        if (!allowed) continue;

        const market = detectMarket(lead.phone);
        const templateName = market === 'IN' ? 'nudge_trial_hindi' : 'nudge_trial';
        await sendTemplate(lead.phone, templateName, [
          lead.name || 'there'
        ]);
        nudged++;
      }
    }

    const { data: staleLeads } = await db.from('leads')
      .select('id')
      .eq('status', 'new')
      .lte('last_msg_at', twentyFourHoursAgo);

    let dropped = 0;
    if (staleLeads) {
      for (const lead of staleLeads) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    const { data: reEngageLeads } = await db.from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('created_at', sevenDaysAgo)
      .lte('created_at', twoDaysAgo);

    let reEngaged = 0;
    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        const { data: msgCount } = await db.from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .gte('sent_at', sevenDaysAgo);

        if (msgCount && msgCount.length >= 4) continue;

        const allowed = await canSendMessage(lead.phone);
        if (!allowed) continue;

        const market = detectMarket(lead.phone);
        const templateName = market === 'IN' ? 'reengage_hindi' : 'reengage';
        await sendTemplate(lead.phone, templateName, [lead.name || 'there']);
        reEngaged++;
      }
    }

    const { data: pendingCheckins } = await db.from('clients')
      .select('id, phone, name')
      .eq('status', 'active');

    let checkinNudged = 0;
    if (pendingCheckins) {
      for (const client of pendingCheckins) {
        const startDate = new Date(client.program_started_at || now);
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.ceil(daysSinceStart / 7);

        const { data: existing } = await db.from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .limit(1);

        if (!existing || existing.length === 0) {
          const allowed = await canSendMessage(client.phone);
          if (allowed) {
            const market = detectMarket(client.phone);
            await sendTemplate(client.phone, market === 'IN' ? 'checkin_reminder_hindi' : 'checkin_reminder', [
              client.name || 'there'
            ]);
            checkinNudged++;
          }
        }
      }
    }

    return res.status(200).json({ nudged, dropped, reEngaged, checkinNudged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
