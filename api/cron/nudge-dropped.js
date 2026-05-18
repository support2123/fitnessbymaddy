const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { maskPhone } = require('../../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers['authorization'];
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;
  if (!isCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    // Re-engage leads that went silent 2-7 days ago (new leads only, not opted-out)
    const { data: staleLeads, error } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoDaysAgo.toISOString())
      .gt('last_msg_at', sevenDaysAgo.toISOString());

    if (error) {
      console.error('Fetch stale leads error:', error);
      return res.status(500).json({ error: 'Failed to fetch leads' });
    }

    const results = { nudged: 0, skipped: 0, errors: 0 };

    for (const lead of (staleLeads || [])) {
      try {
        const { data: recentOut } = await supabase
          .from('messages')
          .select('sent_at')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'nudge_trial')
          .order('sent_at', { ascending: false })
          .limit(1);

        if (recentOut && recentOut.length > 0) {
          const lastNudge = new Date(recentOut[0].sent_at);
          if (Date.now() - lastNudge.getTime() < 7 * 24 * 60 * 60 * 1000) {
            results.skipped++;
            continue;
          }
        }

        const trialUrl = 'https://www.fitnessbymaddy.com/shred.html';
        const waResult = await sendTemplate(lead.phone, 'nudge_trial', [
          lead.name || 'there',
          trialUrl
        ], true);

        if (waResult.ok) results.nudged++;
        else results.errors++;

      } catch (err) {
        console.error(`Nudge error for ${maskPhone(lead.phone)}:`, err.message);
        results.errors++;
      }
    }

    // Also check active clients with pending check-ins (24hr+ nudge)
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);

    const { data: pendingClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    for (const client of (pendingClients || [])) {
      try {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((Date.now() - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSinceStart / 7);
        if (currentWeek < 1) continue;

        const { data: checkin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .single();

        if (checkin) continue;

        const { data: lastMsg } = await supabase
          .from('messages')
          .select('sent_at')
          .eq('phone', client.phone)
          .eq('direction', 'out')
          .eq('template_name', 'checkin_nudge')
          .order('sent_at', { ascending: false })
          .limit(1);

        if (lastMsg && lastMsg.length > 0) {
          const lastSent = new Date(lastMsg[0].sent_at);
          if (Date.now() - lastSent.getTime() < 24 * 60 * 60 * 1000) continue;
        }

        const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;
        await sendTemplate(client.phone, 'checkin_nudge', [
          client.name || 'there',
          String(currentWeek),
          checkinUrl
        ], true);

      } catch (err) {
        console.error(`Client nudge error for ${maskPhone(client.phone)}:`, err.message);
      }
    }

    return res.status(200).json({ ok: true, results });
  } catch (err) {
    console.error('Nudge cron error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
