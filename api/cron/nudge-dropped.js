const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, canSendMessage } = require('../../lib/whatsapp');
const { escalateToMaddy } = require('../../lib/escalation');
const { maskPhone } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    // --- Part 1: Nudge new leads who haven't replied ---
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

    const { data: stalledLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', twentyFourHoursAgo);

    let nudgedLeads = 0;
    if (stalledLeads) {
      for (const lead of stalledLeads) {
        const allowed = await canSendMessage(lead.phone);
        if (allowed) {
          await sendTemplate(lead.phone, 'nudge_trial', [
            'https://fitnessbymaddy.com/program-trial.html',
          ]);
          nudgedLeads++;
        }
      }
    }

    // Drop leads older than 24 hrs with no reply
    const { data: expiredLeads } = await db
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('created_at', twentyFourHoursAgo);

    if (expiredLeads && expiredLeads.length > 0) {
      const ids = expiredLeads.map((l) => l.id);
      await db.from('leads').update({ status: 'dropped' }).in('id', ids);
    }

    // --- Part 2: Re-engage dropped leads (7-day rule) ---
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reEngageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo)
      .gt('last_msg_at', eightDaysAgo);

    let reEngaged = 0;
    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        const allowed = await canSendMessage(lead.phone);
        if (allowed) {
          await sendTemplate(lead.phone, 'reengage_7day', [
            lead.name || 'there',
          ]);
          reEngaged++;
        }
      }
    }

    // --- Part 3: Flag clients with 2 consecutive missed check-ins ---
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let escalated = 0;
    if (activeClients) {
      for (const client of activeClients) {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSinceStart / 7);

        if (currentWeek < 3) continue;

        const { data: recentCheckins } = await db
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .gte('week_no', currentWeek - 2)
          .order('week_no', { ascending: false });

        const submittedWeeks = new Set((recentCheckins || []).map((c) => c.week_no));
        const missed = !submittedWeeks.has(currentWeek - 1) && !submittedWeeks.has(currentWeek - 2);

        if (missed) {
          await escalateToMaddy('2 consecutive missed check-ins', {
            phone: maskPhone(client.phone),
            message: `${client.name || 'Client'} missed weeks ${currentWeek - 2} and ${currentWeek - 1}`,
          });
          escalated++;
        }
      }
    }

    return res.status(200).json({
      ok: true,
      nudgedLeads,
      droppedExpired: expiredLeads?.length || 0,
      reEngaged,
      escalated,
    });
  } catch (err) {
    console.error('nudge-dropped cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
