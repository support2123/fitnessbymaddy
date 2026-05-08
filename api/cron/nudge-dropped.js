const { supabase } = require('../../lib/supabase');
const { sendTemplate, canSendMessage } = require('../../lib/whatsapp');
const { isHinglish, detectMarket } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    let nudgedNew = 0;
    if (newLeads) {
      for (const lead of newLeads) {
        const allowed = await canSendMessage(lead.phone);
        if (!allowed) continue;

        await sendTemplate(lead.phone, 'nudge_trial', [
          lead.name || 'there',
        ]);
        nudgedNew++;
      }
    }

    const { data: staleNewLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    let dropped = 0;
    if (staleNewLeads) {
      for (const lead of staleNewLeads) {
        await supabase
          .from('leads')
          .update({ status: 'dropped' })
          .eq('id', lead.id);
        dropped++;
      }
    }

    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('created_at', sevenDaysAgo)
      .lte('created_at', fourteenDaysAgo);

    let reEngaged = 0;
    if (droppedLeads) {
      for (const lead of droppedLeads) {
        const { count } = await supabase
          .from('messages')
          .select('*', { count: 'exact', head: true })
          .eq('phone', lead.phone)
          .eq('template_name', 'reengage_offer');

        if (count && count > 0) continue;

        const allowed = await canSendMessage(lead.phone);
        if (!allowed) continue;

        const market = detectMarket(lead.phone);
        const hinglish = isHinglish(market);

        await sendTemplate(lead.phone, 'reengage_offer', [
          lead.name || (hinglish ? 'there' : 'there'),
        ]);
        reEngaged++;
      }
    }

    const { data: pendingCheckins } = await supabase
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    let checkinNudges = 0;
    if (pendingCheckins) {
      for (const client of pendingCheckins) {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSinceStart / 7);

        const { data: checkin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .single();

        if (checkin) continue;

        const dayOfWeek = now.getDay();
        if (dayOfWeek !== 1 && dayOfWeek !== 2) continue;

        const allowed = await canSendMessage(client.phone);
        if (!allowed) continue;

        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;
        await sendTemplate(client.phone, 'checkin_nudge', [
          client.name || 'there',
          checkinUrl,
        ]);
        checkinNudges++;
      }
    }

    return res.json({
      nudged_new: nudgedNew,
      dropped,
      re_engaged: reEngaged,
      checkin_nudges: checkinNudges,
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
