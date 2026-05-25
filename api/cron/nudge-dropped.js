const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, checkRateLimit } = require('../../lib/whatsapp');
const { detectMarket, isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const { data: nudgeLeads } = await db
      .from('leads')
      .select('id, phone, name, market, last_msg_at')
      .eq('status', 'new')
      .lt('last_msg_at', twoDaysAgo);

    const results = [];

    if (nudgeLeads && nudgeLeads.length > 0) {
      for (const lead of nudgeLeads) {
        const limited = await checkRateLimit(lead.phone);
        if (limited) {
          results.push({ lead_id: lead.id, action: 'rate_limited' });
          continue;
        }

        const template = isHinglish(lead.market) ? 'nudge_trial' : 'nudge_trial_en';
        await sendTemplate(lead.phone, template, [lead.name || 'there']);
        results.push({ lead_id: lead.id, action: 'nudged' });
      }
    }

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: staleLeads } = await db
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lt('last_msg_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

    if (staleLeads && staleLeads.length > 0) {
      const staleIds = staleLeads.map((l) => l.id);
      await db.from('leads').update({ status: 'dropped' }).in('id', staleIds);
      results.push({ action: 'dropped_stale', count: staleIds.length });
    }

    const { data: activeClients } = await db
      .from('clients')
      .select('id, phone, name')
      .eq('status', 'active');

    if (activeClients) {
      for (const client of activeClients) {
        const { data: pendingCheckins } = await db
          .from('checkins')
          .select('id, week_no, form_submitted_at')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(1);

        if (!pendingCheckins || pendingCheckins.length === 0) continue;

        const lastSubmit = new Date(pendingCheckins[0].form_submitted_at);
        const daysSince = (Date.now() - lastSubmit.getTime()) / (24 * 60 * 60 * 1000);

        if (daysSince >= 8 && daysSince < 9) {
          const limited = await checkRateLimit(client.phone);
          if (!limited) {
            const nextWeek = pendingCheckins[0].week_no + 1;
            const url = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${nextWeek}`;
            await sendTemplate(client.phone, 'checkin_nudge', [client.name || 'Champion', url]);
            results.push({ client_id: client.id, action: 'checkin_nudge' });
          }
        }
      }
    }

    return res.status(200).json({ action: 'nudge_complete', results });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
