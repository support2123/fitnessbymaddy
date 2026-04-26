const { getSupabase } = require('../lib/supabase');
const { sendTemplate, canSendToLead, detectMarket } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !process.env.VERCEL_URL) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    // FLOW A step 3: Nudge new leads who haven't replied in 2 hours
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Nudge new leads (2hr no reply → trial push)
    const { data: newLeads } = await db
      .from('leads')
      .select('id, phone, name, created_at')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', twentyFourHoursAgo);

    let nudged = 0;
    if (newLeads) {
      for (const lead of newLeads) {
        const canSend = await canSendToLead(lead.phone);
        if (!canSend) continue;

        const market = detectMarket(lead.phone);
        const template = market === 'IN' ? 'nudge_trial_hindi' : 'nudge_trial';
        await sendTemplate(lead.phone, template, [
          lead.name || 'there',
          'https://fitnessbymaddy.com/program-trial.html'
        ]);
        nudged++;
        await new Promise(r => setTimeout(r, 500));
      }
    }

    // Drop leads with no reply after 24 hours
    let dropped = 0;
    const { data: staleLeads } = await db
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('created_at', twentyFourHoursAgo);

    if (staleLeads) {
      for (const lead of staleLeads) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    // Re-engage dropped leads (7-day rule) — one-time re-engagement
    const { data: droppedLeads } = await db
      .from('leads')
      .select('id, phone, name')
      .eq('status', 'dropped')
      .gt('created_at', sevenDaysAgo)
      .lt('created_at', new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString());

    let reengaged = 0;
    if (droppedLeads) {
      for (const lead of droppedLeads) {
        // Check if we already re-engaged
        const { data: priorReengage } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'reengage_7day')
          .limit(1);

        if (priorReengage && priorReengage.length > 0) continue;

        const market = detectMarket(lead.phone);
        const template = market === 'IN' ? 'reengage_7day_hindi' : 'reengage_7day';
        await sendTemplate(lead.phone, template, [lead.name || 'there']);
        reengaged++;
        await new Promise(r => setTimeout(r, 500));
      }
    }

    // Nudge active clients who missed check-in (+24hr, +48hr)
    const { data: activeClients } = await db
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    let clientNudged = 0;
    if (activeClients) {
      for (const client of activeClients) {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysDiff = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.ceil(daysDiff / 7);
        const dayInWeek = daysDiff % 7;

        // Nudge on day 1 and day 2 after checkin was due (Sunday)
        if (dayInWeek !== 1 && dayInWeek !== 2) continue;

        const { data: checkin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (checkin) continue;

        const canSend = await canSendToLead(client.phone);
        if (!canSend) continue;

        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
        await sendTemplate(client.phone, 'checkin_reminder', [
          client.name || 'there',
          String(weekNo),
          checkinUrl
        ]);
        clientNudged++;
        await new Promise(r => setTimeout(r, 500));
      }
    }

    return res.json({
      ok: true,
      nudged,
      dropped,
      reengaged,
      client_nudged: clientNudged
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
