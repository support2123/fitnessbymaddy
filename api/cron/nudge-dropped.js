const { getSupabase } = require('../lib/supabase');
const { sendTemplate, maskPhone } = require('../lib/whatsapp');
const { canSendMessage, logMessage } = require('../lib/ratelimit');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

    // Re-engage leads that went silent 2-7 days ago (not replied after welcome)
    const { data: stalledLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoDaysAgo)
      .gt('created_at', sevenDaysAgo);

    let nudged = 0;
    const errors = [];

    if (stalledLeads && stalledLeads.length > 0) {
      for (const lead of stalledLeads) {
        try {
          const canSend = await canSendMessage(lead.phone);
          if (!canSend) continue;

          await sendTemplate(lead.phone, 'nudge_trial', {
            name: lead.name || 'there',
            templateParams: [
              lead.name || 'there',
              'https://fitnessbymaddy.com/program-trial.html',
            ],
          });

          await logMessage(lead.phone, 'out', 'Nudge trial sent', 'nudge_trial');
          nudged++;
        } catch (leadErr) {
          errors.push({ lead: maskPhone(lead.phone), error: leadErr.message });
        }
      }
    }

    // Mark leads older than 7 days with no response as dropped
    const { data: expiredLeads } = await db
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('last_msg_at', sevenDaysAgo);

    let dropped = 0;
    if (expiredLeads && expiredLeads.length > 0) {
      const ids = expiredLeads.map(l => l.id);
      await db.from('leads').update({ status: 'dropped' }).in('id', ids);
      dropped = ids.length;
    }

    // Nudge active clients with missed check-ins
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let clientNudges = 0;

    if (activeClients) {
      for (const client of activeClients) {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.floor(daysSinceStart / 7) + 1;

        const { data: checkin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (!checkin && daysSinceStart % 7 >= 1) {
          try {
            const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
            await sendTemplate(client.phone, 'checkin_reminder', {
              name: client.name || 'there',
              templateParams: [client.name || 'there', checkinUrl],
            });
            await logMessage(client.phone, 'out', `Check-in reminder (week ${weekNo})`, 'checkin_reminder');
            clientNudges++;
          } catch (err) {
            errors.push({ client: maskPhone(client.phone), error: err.message });
          }
        }

        // 2 consecutive missed check-ins → escalate
        if (weekNo >= 3) {
          const { data: recentCheckins } = await db
            .from('checkins')
            .select('week_no')
            .eq('client_id', client.id)
            .gte('week_no', weekNo - 2)
            .lte('week_no', weekNo - 1);

          if (!recentCheckins || recentCheckins.length === 0) {
            const { notifyMaddy } = require('../lib/whatsapp');
            await notifyMaddy(
              '2 Missed Check-ins',
              `Client ${client.name || maskPhone(client.phone)} missed weeks ${weekNo - 2} and ${weekNo - 1}`
            );
          }
        }
      }
    }

    return res.status(200).json({
      nudged,
      dropped,
      clientNudges,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error('Nudge cron error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
