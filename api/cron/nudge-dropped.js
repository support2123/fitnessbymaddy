const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { detectMarket } = require('../../lib/helpers');

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization || '';
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const now = new Date();

  // Nudge leads that haven't replied after 2 hours (new leads)
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const results = { nudged: 0, dropped: 0, re_engaged: 0 };

  // 1. Two-hour nudge for new leads with no reply
  const { data: newLeads } = await db
    .from('leads')
    .select('id, phone, name, market, created_at')
    .eq('status', 'new')
    .lte('created_at', twoHoursAgo)
    .gte('created_at', twentyFourHoursAgo);

  if (newLeads) {
    for (const lead of newLeads) {
      const { count } = await db
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'nudge_trial');

      if (count > 0) continue;

      const market = lead.market || detectMarket(lead.phone);
      const template = market === 'IN' ? 'nudge_trial_hi' : 'nudge_trial_en';
      await sendWhatsApp(lead.phone, template, [
        lead.name || 'there',
        'https://www.fitnessbymaddy.com/program-trial.html',
      ]);
      results.nudged++;
    }
  }

  // 2. Drop leads that are 24+ hours old with no reply
  const { data: staleLeads } = await db
    .from('leads')
    .select('id')
    .eq('status', 'new')
    .lte('created_at', twentyFourHoursAgo);

  if (staleLeads) {
    for (const lead of staleLeads) {
      const { count } = await db
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('direction', 'in');

      const inboundAfterFirst = count || 0;
      if (inboundAfterFirst <= 1) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        results.dropped++;
      }
    }
  }

  // 3. Re-engage dropped leads (7-day rule — one re-engagement attempt)
  const { data: droppedLeads } = await db
    .from('leads')
    .select('id, phone, name, market, last_msg_at')
    .eq('status', 'dropped')
    .lte('last_msg_at', sevenDaysAgo);

  if (droppedLeads) {
    for (const lead of droppedLeads) {
      const { count } = await db
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 're_engage');

      if (count > 0) continue;

      const market = lead.market || detectMarket(lead.phone);
      const template = market === 'IN' ? 're_engage_hi' : 're_engage_en';
      await sendWhatsApp(lead.phone, template, [lead.name || 'there']);
      results.re_engaged++;
    }
  }

  // 4. Nudge clients who haven't submitted check-in (+24h, +48h)
  const { data: pendingClients } = await db
    .from('clients')
    .select('id, phone, name, program_started_at')
    .eq('status', 'active');

  if (pendingClients) {
    for (const client of pendingClients) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) continue;

      const { data: checkin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (checkin) continue;

      const dayOfWeek = now.getDay();
      // Sunday = 0, so Monday = 1 (+24h), Tuesday = 2 (+48h)
      if (dayOfWeek === 1 || dayOfWeek === 2) {
        const market = detectMarket(client.phone);
        const template = market === 'IN' ? 'checkin_reminder_hi' : 'checkin_reminder_en';
        const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
        await sendWhatsApp(client.phone, template, [
          client.name || 'there',
          String(weekNo),
          checkinUrl,
        ]);
      }
    }
  }

  return res.status(200).json({
    action: 'nudge_complete',
    results,
  });
};
