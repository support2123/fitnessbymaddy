const { getSupabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { maskPhone } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const results = { leads_nudged: 0, checkin_nudges: 0, errors: 0 };

    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString();
    const oneDayAgo = new Date(Date.now() - 1 * 86400000).toISOString();

    const { data: newLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twoDaysAgo)
      .gte('created_at', sevenDaysAgo);

    if (newLeads) {
      for (const lead of newLeads) {
        try {
          const { data: recentMsg } = await db
            .from('messages')
            .select('sent_at')
            .eq('phone', lead.phone)
            .eq('direction', 'out')
            .gte('sent_at', oneDayAgo)
            .limit(1)
            .single();

          if (recentMsg) continue;

          await sendTemplate(lead.phone, 'nudge_trial', [
            lead.name || 'there',
            'https://www.fitnessbymaddy.com/program-trial.html'
          ]);
          results.leads_nudged++;
        } catch (err) {
          console.error(`Lead nudge failed for ${maskPhone(lead.phone)}:`, err.message);
          results.errors++;
        }
      }
    }

    const { data: overdueLeads } = await db
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lt('created_at', sevenDaysAgo);

    if (overdueLeads) {
      const overdueIds = overdueLeads.map(l => l.id);
      if (overdueIds.length > 0) {
        await db.from('leads')
          .update({ status: 'dropped' })
          .in('id', overdueIds);
      }
    }

    const { data: activeClients } = await db
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    if (activeClients) {
      for (const client of activeClients) {
        try {
          const startDate = new Date(client.program_started_at);
          const daysSinceStart = Math.floor((Date.now() - startDate) / 86400000);
          const currentWeek = Math.ceil(daysSinceStart / 7);

          if (currentWeek < 1) continue;

          const { data: checkin } = await db
            .from('checkins')
            .select('id')
            .eq('client_id', client.id)
            .eq('week_no', currentWeek)
            .single();

          if (checkin) continue;

          const dayOfWeek = new Date().getDay();
          if (dayOfWeek >= 2 && dayOfWeek <= 3) {
            const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;
            await sendTemplate(client.phone, 'checkin_reminder', [
              client.name || 'there',
              String(currentWeek),
              checkinUrl
            ]);
            results.checkin_nudges++;
          }
        } catch (err) {
          console.error(`Checkin nudge failed for ${maskPhone(client.phone)}:`, err.message);
          results.errors++;
        }
      }
    }

    console.log(`Nudge cron: ${JSON.stringify(results)}`);
    res.status(200).json({ status: 'completed', results });
  } catch (err) {
    console.error('nudge-dropped cron error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
};
