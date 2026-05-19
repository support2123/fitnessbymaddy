const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();

    // Nudge leads that haven't replied in 2 hours (first nudge)
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const { data: staleNewLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo);

    let nudged = 0;

    if (staleNewLeads) {
      for (const lead of staleNewLeads) {
        const hoursSinceLastMsg = (now - new Date(lead.last_msg_at)) / (1000 * 60 * 60);

        if (hoursSinceLastMsg >= 2 && hoursSinceLastMsg < 24) {
          await sendTemplate(lead.phone, 'nudge_trial', [
            lead.name || 'there',
            'https://www.fitnessbymaddy.com/program-trial.html'
          ]);
          nudged++;
        } else if (hoursSinceLastMsg >= 24) {
          await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        }
      }
    }

    // Re-engage dropped leads after 7 days (one-time attempt)
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reEngageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo)
      .gt('last_msg_at', eightDaysAgo);

    let reEngaged = 0;

    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        await sendTemplate(lead.phone, 'reengage_7day', [
          lead.name || 'there'
        ]);
        reEngaged++;
      }
    }

    // Nudge active clients who haven't submitted check-ins
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const twoDaysAgo = new Date(now - 48 * 60 * 60 * 1000).toISOString();

    const { data: pendingCheckins } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let checkinNudged = 0;

    if (pendingCheckins) {
      for (const client of pendingCheckins) {
        const weekNo = calculateCurrentWeek(client.program_started_at);
        if (weekNo < 1) continue;

        const { data: checkin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (!checkin) {
          const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
          await sendTemplate(client.phone, 'checkin_reminder', [
            client.name || 'there',
            checkinUrl
          ]);
          checkinNudged++;
        }
      }
    }

    return res.status(200).json({
      success: true,
      nudged,
      reEngaged,
      checkinNudged
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateCurrentWeek(programStartedAt) {
  if (!programStartedAt) return 0;
  const start = new Date(programStartedAt);
  const now = new Date();
  const diffDays = Math.floor((now - start) / (1000 * 60 * 60 * 24));
  return Math.floor(diffDays / 7) + 1;
}
