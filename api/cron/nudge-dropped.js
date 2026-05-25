const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const { data: staleNewLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoDaysAgo);

    let nudged = 0;
    let dropped = 0;

    if (staleNewLeads) {
      for (const lead of staleNewLeads) {
        const hoursSinceMsg = (Date.now() - new Date(lead.last_msg_at).getTime()) / (1000 * 60 * 60);

        if (hoursSinceMsg >= 24) {
          await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
          dropped++;
        } else if (hoursSinceMsg >= 2) {
          await sendTemplate(lead.phone, 'nudge_trial', [
            'https://fitnessbymaddy.com/program-trial.html'
          ]);
          nudged++;
        }
      }
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reEngageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gt('last_msg_at', thirtyDaysAgo)
      .lt('last_msg_at', sevenDaysAgo);

    let reEngaged = 0;

    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        const { count } = await db
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('phone', lead.phone)
          .eq('template_name', 'win_back');

        if (count === 0) {
          await sendTemplate(lead.phone, 'win_back', [lead.name || 'there']);
          reEngaged++;
        }
      }
    }

    const { data: pendingCheckins } = await db
      .from('checkins')
      .select('*, clients!inner(*)')
      .is('form_submitted_at', null)
      .eq('clients.status', 'active');

    let checkinNudges = 0;

    if (pendingCheckins) {
      for (const checkin of pendingCheckins) {
        const createdAt = new Date(checkin.created_at);
        const hoursSince = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);

        if (hoursSince >= 24 && hoursSince < 48) {
          const url = `https://fitnessbymaddy.com/checkin.html?c=${checkin.client_id}&w=${checkin.week_no}`;
          await sendTemplate(checkin.clients.phone, 'checkin_reminder', [
            checkin.clients.name || 'there',
            url
          ]);
          checkinNudges++;
        } else if (hoursSince >= 48) {
          const url = `https://fitnessbymaddy.com/checkin.html?c=${checkin.client_id}&w=${checkin.week_no}`;
          await sendTemplate(checkin.clients.phone, 'checkin_urgent', [
            checkin.clients.name || 'there',
            url
          ]);
          checkinNudges++;
        }
      }
    }

    return res.status(200).json({
      success: true,
      nudged, dropped, reEngaged, checkinNudges
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
