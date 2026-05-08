const { supabase } = require('../../lib/supabase');
const { sendTemplate, canSendMessage, maskPhone } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('last_msg_at', twentyFourHoursAgo);

    const results = [];

    for (const lead of (newLeads || [])) {
      if (await canSendMessage(lead.phone, false)) {
        await sendTemplate(lead.phone, 'nudge_trial', [
          lead.name || 'there',
          'https://fitnessbymaddy.com/program-trial.html',
        ]);
        results.push({ phone: maskPhone(lead.phone), action: 'nudged' });
      }
    }

    const { data: staleLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twentyFourHoursAgo);

    for (const lead of (staleLeads || [])) {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('id', lead.id);
      results.push({ phone: maskPhone(lead.phone), action: 'dropped' });
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data: reengageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gt('last_msg_at', fourteenDaysAgo)
      .lt('last_msg_at', sevenDaysAgo);

    for (const lead of (reengageLeads || [])) {
      if (await canSendMessage(lead.phone, false)) {
        await sendTemplate(lead.phone, 'reengage_7day', [
          lead.name || 'there',
        ]);
        results.push({ phone: maskPhone(lead.phone), action: 'reengaged' });
      }
    }

    const { data: pendingCheckins } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    for (const client of (pendingCheckins || [])) {
      const programStart = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((Date.now() - programStart) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.floor(daysSinceStart / 7) + 1;

      const { data: checkin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (!checkin) {
        const dayOfWeek = new Date().getDay();
        if (dayOfWeek === 1 || dayOfWeek === 2) {
          const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;
          await sendTemplate(client.phone, 'checkin_reminder', [
            client.name || 'there',
            String(currentWeek),
            checkinUrl,
          ]);
          results.push({ phone: maskPhone(client.phone), action: 'checkin_nudge' });
        }
      }
    }

    return res.status(200).json({
      ok: true,
      processed: results.length,
      results,
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
