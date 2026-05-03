const { getSupabase } = require('../lib/supabase');
const { sendTemplate, detectMarket, isHinglish } = require('../lib/whatsapp');
const { createEscalation } = require('../lib/escalate');
const { weekNumber } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const now = new Date();

  // --- Nudge new leads with no reply after 2 hours ---
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const { data: staleNewLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('created_at', twoHoursAgo.toISOString());

  let nudgedLeads = 0;
  if (staleNewLeads) {
    for (const lead of staleNewLeads) {
      const { data: replies } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gt('sent_at', lead.created_at)
        .limit(1);

      if (replies && replies.length > 0) continue;

      const { count } = await db
        .from('messages')
        .select('id', { count: 'exact' })
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'nudge_trial');

      if (count && count > 0) continue;

      await sendTemplate(lead.phone, 'nudge_trial', {
        name: lead.name || 'there',
        templateParams: [
          lead.name || 'there',
          'https://fitnessbymaddy.com/program-trial.html'
        ]
      });
      nudgedLeads++;
    }
  }

  // --- Drop leads with no reply after 24 hours ---
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const { data: deadLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('created_at', oneDayAgo.toISOString());

  let dropped = 0;
  if (deadLeads) {
    for (const lead of deadLeads) {
      const { data: replies } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gt('sent_at', lead.created_at)
        .limit(1);

      if (replies && replies.length > 0) continue;

      await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
      dropped++;
    }
  }

  // --- Re-engage dropped leads (7-day rule: only if dropped > 7 days ago) ---
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
  const { data: reEngageLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'dropped')
    .lt('last_msg_at', sevenDaysAgo.toISOString())
    .gt('last_msg_at', eightDaysAgo.toISOString());

  let reEngaged = 0;
  if (reEngageLeads) {
    for (const lead of reEngageLeads) {
      const market = detectMarket(lead.phone);
      const hinglish = isHinglish(market);

      await sendTemplate(lead.phone, 'reengage_7day', {
        name: lead.name || 'there',
        templateParams: [lead.name || 'there']
      });
      reEngaged++;
    }
  }

  // --- Nudge clients with missed check-ins ---
  const { data: activeClients } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active');

  let clientNudges = 0;
  let escalatedClients = 0;

  if (activeClients) {
    for (const client of activeClients) {
      const wk = weekNumber(client.program_started_at);

      const { data: recentCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const submittedWeeks = (recentCheckins || []).map(c => c.week_no);

      if (!submittedWeeks.includes(wk) && !submittedWeeks.includes(wk - 1)) {
        await createEscalation(
          client.phone,
          '2 consecutive missed check-ins',
          `Client ${client.name || client.id} missed weeks ${wk - 1} and ${wk}`
        );
        escalatedClients++;
      } else if (!submittedWeeks.includes(wk)) {
        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${wk}`;
        await sendTemplate(client.phone, 'checkin_reminder', {
          name: client.name || 'there',
          templateParams: [client.name || 'there', `${wk}`, checkinUrl]
        });
        clientNudges++;
      }
    }
  }

  return res.status(200).json({
    nudgedLeads,
    dropped,
    reEngaged,
    clientNudges,
    escalatedClients
  });
};
