const { supabase } = require('../_lib/supabase');
const { sendTemplate, canSendMessage } = require('../_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const isAuthed = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isAuthed) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: newLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .eq('opted_out', false)
      .lt('last_msg_at', twoHoursAgo);

    let nudgedNew = 0;
    if (newLeads) {
      for (const lead of newLeads) {
        const hoursSinceMsg = (Date.now() - new Date(lead.last_msg_at).getTime()) / (1000 * 60 * 60);

        if (hoursSinceMsg >= 24) {
          await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
          continue;
        }

        if (hoursSinceMsg >= 2) {
          const canSend = await canSendMessage(lead.phone, false);
          if (canSend) {
            await sendTemplate(lead.phone, 'nudge_trial', [
              lead.name || 'there',
              'https://fitnessbymaddy.com/program-trial.html',
            ]);
            nudgedNew++;
          }
        }
      }
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .eq('opted_out', false)
      .gte('created_at', sevenDaysAgo)
      .lt('last_msg_at', threeDaysAgo);

    let reengaged = 0;
    if (droppedLeads) {
      for (const lead of droppedLeads) {
        const canSend = await canSendMessage(lead.phone, false);
        if (canSend) {
          await sendTemplate(lead.phone, 'win_back', [
            lead.name || 'there',
          ]);
          reengaged++;
        }
      }
    }

    const { data: activeClients } = await supabase
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    let checkinNudges = 0;
    if (activeClients) {
      for (const client of activeClients) {
        const weekNo = Math.ceil(
          (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
        );

        const { data: checkin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (!checkin) {
          const dayOfWeek = new Date().getDay();
          if (dayOfWeek === 1 || dayOfWeek === 2) {
            await sendTemplate(client.phone, 'checkin_reminder', [
              client.name || 'there',
              `${weekNo}`,
              `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`,
            ]);
            checkinNudges++;
          }
        }
      }
    }

    return res.status(200).json({
      action: 'nudge_complete',
      nudged_new: nudgedNew,
      reengaged,
      checkin_nudges: checkinNudges,
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
