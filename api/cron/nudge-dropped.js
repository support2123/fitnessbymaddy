const { getClient } = require('../../lib/supabase');
const { sendTemplate, maskPhone } = require('../../lib/whatsapp');
const { logMessage, canSendTo, isOptedOut } = require('../../lib/messages');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sb = getClient();

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: newLeads } = await sb
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    let nudged = 0;
    let dropped = 0;

    if (newLeads) {
      for (const lead of newLeads) {
        if (await isOptedOut(lead.phone)) continue;

        const hoursSinceCreated = (Date.now() - new Date(lead.created_at).getTime()) / (1000 * 60 * 60);

        if (hoursSinceCreated >= 24) {
          await sb.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
          dropped++;
          continue;
        }

        if (hoursSinceCreated >= 2 && await canSendTo(lead.phone)) {
          await sendTemplate(lead.phone, 'nudge_trial', [
            lead.name || 'there',
            'https://www.fitnessbymaddy.com/program-trial.html',
          ]);
          await logMessage(lead.phone, 'out', 'Trial nudge sent', 'nudge_trial');
          nudged++;
        }
      }
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data: reengageLeads } = await sb
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gt('created_at', fourteenDaysAgo)
      .lt('created_at', sevenDaysAgo);

    let reengaged = 0;
    if (reengageLeads) {
      for (const lead of reengageLeads) {
        if (await isOptedOut(lead.phone)) continue;
        if (!(await canSendTo(lead.phone))) continue;

        const { data: msgs } = await sb
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'reengage_7day')
          .limit(1);

        if (msgs && msgs.length > 0) continue;

        await sendTemplate(lead.phone, 'reengage_7day', [lead.name || 'there']);
        await logMessage(lead.phone, 'out', '7-day re-engage sent', 'reengage_7day');
        reengaged++;
      }
    }

    const { data: pendingCheckins } = await sb
      .from('clients')
      .select('id, phone, name, program_started_at, program')
      .eq('status', 'active');

    let checkinNudges = 0;
    if (pendingCheckins) {
      for (const client of pendingCheckins) {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((Date.now() - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.ceil(daysSinceStart / 7);
        if (weekNo < 1) continue;

        const { data: checkin } = await sb
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .limit(1);

        if (checkin && checkin.length > 0) continue;

        const dayOfWeek = new Date().getDay();
        if (dayOfWeek === 1 || dayOfWeek === 2) {
          if (await canSendTo(client.phone)) {
            const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
            await sendTemplate(client.phone, 'checkin_nudge', [
              client.name || 'there',
              `${weekNo}`,
              checkinUrl,
            ]);
            await logMessage(client.phone, 'out', `Check-in nudge week ${weekNo}`, 'checkin_nudge');
            checkinNudges++;
          }
        }
      }
    }

    console.log(`[CRON_NUDGE] Nudged: ${nudged}, Dropped: ${dropped}, Re-engaged: ${reengaged}, Checkin nudges: ${checkinNudges}`);
    return res.status(200).json({ nudged, dropped, reengaged, checkin_nudges: checkinNudges });
  } catch (err) {
    console.error('[CRON_NUDGE]', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
