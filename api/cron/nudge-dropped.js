const { getClient } = require('../../lib/supabase');
const { sendRateLimited } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  try {
    const supabase = getClient();

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeadsToNudge } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twentyFourHoursAgo)
      .gt('created_at', sevenDaysAgo);

    let nudged = 0;
    let dropped = 0;

    if (newLeadsToNudge) {
      for (const lead of newLeadsToNudge) {
        const hoursSinceLastMsg = (Date.now() - new Date(lead.last_msg_at).getTime()) / (1000 * 60 * 60);

        if (hoursSinceLastMsg >= 24) {
          await supabase.from('leads')
            .update({ status: 'dropped' })
            .eq('id', lead.id);
          dropped++;
          continue;
        }

        if (hoursSinceLastMsg >= 2) {
          await sendRateLimited(supabase, lead.phone, 'nudge_trial', {
            name: lead.name || 'there'
          }, false);
          nudged++;
        }
      }
    }

    const { data: qualifiedToNudge } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'qualified')
      .lt('last_msg_at', sevenDaysAgo);

    if (qualifiedToNudge) {
      for (const lead of qualifiedToNudge) {
        await sendRateLimited(supabase, lead.phone, 'reminder_checkout', {
          name: lead.name || 'there',
          program: lead.program_interest || 'program'
        }, false);
        nudged++;
      }
    }

    const { data: pendingCheckins } = await supabase
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    if (pendingCheckins) {
      for (const client of pendingCheckins) {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((Date.now() - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSinceStart / 7);
        const dayOfWeek = new Date().getDay();

        if (dayOfWeek === 1 || dayOfWeek === 2) {
          const { data: checkin } = await supabase
            .from('checkins')
            .select('id')
            .eq('client_id', client.id)
            .eq('week_no', currentWeek)
            .single();

          if (!checkin) {
            const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;
            await sendRateLimited(supabase, client.phone, 'checkin_reminder', {
              name: client.name || 'there',
              checkin_url: checkinUrl
            }, true);
            nudged++;
          }
        }
      }
    }

    console.log(`Nudge cron: nudged=${nudged}, dropped=${dropped}`);
    return res.status(200).json({ ok: true, nudged, dropped });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
