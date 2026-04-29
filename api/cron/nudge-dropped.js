const { getLeadsPendingNudge, getDroppedLeadsForReEngagement, updateLead, getActiveClients, getClient } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { escalateToMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    let nudged = 0;
    let dropped = 0;
    let reEngaged = 0;
    let checkinNudges = 0;

    const twoHourLeads = await getLeadsPendingNudge(2, 'new');
    for (const lead of twoHourLeads) {
      const hoursSinceMsg = (Date.now() - new Date(lead.last_msg_at).getTime()) / (1000 * 60 * 60);

      if (hoursSinceMsg >= 24) {
        await updateLead(lead.id, { status: 'dropped' });
        dropped++;
      } else if (hoursSinceMsg >= 2 && hoursSinceMsg < 24) {
        await sendTemplate(lead.phone, 'nudge_trial', [lead.name || 'there']);
        nudged++;
      }
    }

    const reEngageable = await getDroppedLeadsForReEngagement();
    for (const lead of reEngageable) {
      const daysSinceDrop = (Date.now() - new Date(lead.last_msg_at).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceDrop >= 5 && daysSinceDrop <= 7) {
        await sendTemplate(lead.phone, 'reengage_offer', [lead.name || 'there']);
        reEngaged++;
      }
    }

    const clients = await getActiveClients();
    const db = getClient();
    for (const client of clients) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) continue;

      const { data: checkin } = await db
        .from('checkins')
        .select('id, form_submitted_at')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (!checkin) {
        const dayOfWeek = new Date().getDay();
        if (dayOfWeek === 1 || dayOfWeek === 2) {
          const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
          await sendTemplate(client.phone, 'checkin_reminder', [
            client.name || 'there',
            `${weekNo}`,
            checkinUrl,
          ]);
          checkinNudges++;
        }
      }

      const { data: recentCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      if (weekNo >= 3 && (!recentCheckins || recentCheckins.length === 0 ||
        (recentCheckins.length < 2 && weekNo - (recentCheckins[0]?.week_no || 0) >= 2))) {
        await escalateToMaddy('2 consecutive missed check-ins', {
          phone: client.phone,
          name: client.name,
          message: `Client has missed check-ins. Current week: ${weekNo}`,
        });
      }
    }

    return res.status(200).json({ nudged, dropped, reEngaged, checkinNudges });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
