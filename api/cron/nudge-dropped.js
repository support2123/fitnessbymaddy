const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, canSendMessage, detectMarket } = require('../../lib/whatsapp');
const { notifyMaddy, maskPhone } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const now = new Date();
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Nudge new leads with no reply after 2 hours
    const { data: newLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .eq('opted_out', false)
      .lte('created_at', twoHoursAgo)
      .gte('created_at', twentyFourHoursAgo);

    let nudged = 0;

    if (newLeads) {
      for (const lead of newLeads) {
        const { data: replies } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .gte('sent_at', lead.created_at)
          .limit(2);

        if (replies && replies.length <= 1 && (await canSendMessage(lead.phone))) {
          const market = detectMarket(lead.phone);
          const template = market === 'IN' ? 'nudge_trial_hi' : 'nudge_trial_en';
          await sendTemplate(lead.phone, template, [
            lead.name || 'there',
            'https://fitnessbymaddy.com/intake?lead=' + lead.id,
          ]);
          nudged++;
        }
      }
    }

    // Drop leads with no reply after 24 hours
    const { data: staleLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .eq('opted_out', false)
      .lte('created_at', twentyFourHoursAgo);

    let dropped = 0;

    if (staleLeads) {
      for (const lead of staleLeads) {
        const { data: replies } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .gte('sent_at', lead.created_at)
          .limit(2);

        if (!replies || replies.length <= 1) {
          await db
            .from('leads')
            .update({ status: 'dropped' })
            .eq('id', lead.id);
          dropped++;
        }
      }
    }

    // Re-engage dropped leads from 7 days ago (one-time nudge)
    const sevenDaysAgoStart = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const sevenDaysAgoEnd = new Date(now - 6 * 24 * 60 * 60 * 1000);

    const { data: reengageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .eq('opted_out', false)
      .eq('escalated', false)
      .gte('created_at', sevenDaysAgoStart.toISOString())
      .lte('created_at', sevenDaysAgoEnd.toISOString());

    let reengaged = 0;

    if (reengageLeads) {
      for (const lead of reengageLeads) {
        if (await canSendMessage(lead.phone)) {
          const market = detectMarket(lead.phone);
          const template = market === 'IN' ? 'reengage_hi' : 'reengage_en';
          await sendTemplate(lead.phone, template, [lead.name || 'there']);
          reengaged++;
        }
      }
    }

    // Check for clients with 2+ missed check-ins
    const { data: activeClients } = await db
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    let escalated = 0;

    if (activeClients) {
      for (const client of activeClients) {
        const startDate = new Date(client.program_started_at);
        const daysSince = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSince / 7);

        if (currentWeek < 3) continue;

        const { data: checkins } = await db
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .gte('week_no', currentWeek - 2);

        if (!checkins || checkins.length === 0) {
          await notifyMaddy(
            '2 consecutive missed check-ins',
            `Client: ${maskPhone(client.phone)} (${client.name || 'Unknown'})`
          );
          escalated++;
        }
      }
    }

    return res.json({ nudged, dropped, reengaged, escalated });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
