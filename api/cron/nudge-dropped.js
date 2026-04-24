const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getSupabase();

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .gte('created_at', fourteenDaysAgo)
      .lte('last_msg_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString());

    let nudged = 0;

    if (newLeads) {
      for (const lead of newLeads) {
        const hoursSinceLastMsg = (Date.now() - new Date(lead.last_msg_at).getTime()) / (1000 * 60 * 60);

        if (hoursSinceLastMsg >= 2 && hoursSinceLastMsg < 24) {
          await sendWhatsApp(lead.phone, 'nudge_trial', {
            name: lead.name || 'there',
            templateParams: [lead.name || 'there']
          });
          nudged++;
        } else if (hoursSinceLastMsg >= 24) {
          await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        }
      }
    }

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('created_at', sevenDaysAgo);

    let reengaged = 0;

    if (droppedLeads) {
      for (const lead of droppedLeads) {
        const daysSinceCreated = (Date.now() - new Date(lead.created_at).getTime()) / (1000 * 60 * 60 * 24);

        if (daysSinceCreated >= 5 && daysSinceCreated <= 8) {
          const { data: msgs } = await db
            .from('messages')
            .select('id')
            .eq('phone', lead.phone)
            .eq('template_name', 'reengagement_offer')
            .limit(1);

          if (!msgs || msgs.length === 0) {
            await sendWhatsApp(lead.phone, 'reengagement_offer', {
              name: lead.name || 'there',
              templateParams: [lead.name || 'there']
            }, true);
            reengaged++;
          }
        }
      }
    }

    const { data: pendingCheckins } = await db
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    let checkinNudges = 0;

    if (pendingCheckins) {
      for (const client of pendingCheckins) {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSinceStart / 7);

        if (currentWeek < 1) continue;

        const { data: checkin } = await db
          .from('checkins')
          .select('id, form_submitted_at')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .limit(1)
          .single();

        if (!checkin) {
          const dayOfWeek = new Date().getDay();
          if (dayOfWeek === 1 || dayOfWeek === 2) {
            const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;
            await sendWhatsApp(client.phone, 'checkin_reminder', {
              name: client.name,
              templateParams: [client.name || 'there', checkinUrl]
            });
            checkinNudges++;
          }
        }
      }
    }

    return res.status(200).json({
      ok: true,
      nudged,
      reengaged,
      checkinNudges
    });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
