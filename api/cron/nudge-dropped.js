const { getSupabase } = require('../lib/supabase');
const { sendTemplate, sendText, detectMarket } = require('../lib/whatsapp');
const { canSendTo } = require('../lib/rate-limit');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;
  if (!isCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    // New leads with no reply after 2 hours — send nudge
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Auto-drop leads silent for 24+ hours
    await db.from('leads')
      .update({ status: 'dropped' })
      .eq('status', 'new')
      .eq('opted_out', false)
      .lt('last_msg_at', twentyFourHoursAgo);

    // Nudge new leads who haven't replied in 2+ hours
    const { data: staleLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .eq('opted_out', false)
      .lt('last_msg_at', twoHoursAgo)
      .gte('last_msg_at', twentyFourHoursAgo);

    let nudged = 0;

    if (staleLeads) {
      for (const lead of staleLeads) {
        if (!(await canSendTo(lead.phone))) continue;

        const market = detectMarket(lead.phone);
        if (market === 'IN') {
          await sendText(lead.phone,
            `Hey! Maddy ka $20 trial session try karna hai? Ek Zoom call mein samajh aa jayega ki program kaisa hoga.\n\n` +
            `Book here: https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial\n\n` +
            `No pressure — sirf try karo!`
          );
        } else {
          await sendText(lead.phone,
            `Hey! Want to try Maddy's $20 trial session? A single Zoom call to see if the program is right for you.\n\n` +
            `Book here: https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial\n\n` +
            `No pressure — just try it out!`
          );
        }
        nudged++;
      }
    }

    // Re-engage dropped leads (7-day rule) — only once
    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .eq('opted_out', false)
      .gte('last_msg_at', sevenDaysAgo);

    let reengaged = 0;

    if (droppedLeads) {
      for (const lead of droppedLeads) {
        const { data: recentMessages } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .gte('sent_at', sevenDaysAgo)
          .limit(3);

        if (recentMessages && recentMessages.length >= 3) continue;

        if (!(await canSendTo(lead.phone))) continue;

        await sendTemplate(lead.phone, 'reengage_7day', {
          name: lead.name || 'there',
          templateParams: [lead.name || 'there']
        });
        reengaged++;
      }
    }

    // Nudge active clients with missing check-ins
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let clientNudged = 0;

    if (activeClients) {
      for (const client of activeClients) {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.floor(daysSinceStart / 7) + 1;

        const { data: checkin } = await db
          .from('checkins')
          .select('id, form_submitted_at')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (checkin) continue;

        const dayOfWeek = now.getDay();
        if (dayOfWeek !== 1 && dayOfWeek !== 2) continue;

        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
        await sendText(client.phone,
          `Reminder: Your Week ${weekNo} check-in is still pending!\n\n` +
          `Quick form here: ${checkinUrl}\n\n` +
          `It takes 2 minutes and helps Maddy tailor your next week.`
        );
        clientNudged++;

        // Escalate if 2 consecutive missed
        const { data: recentCheckins } = await db
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(1);

        const lastWeek = recentCheckins?.[0]?.week_no || 0;
        if (weekNo - lastWeek >= 2) {
          const { createEscalation } = require('../lib/escalation');
          await createEscalation(
            client.phone,
            '2 consecutive missed check-ins',
            `Client ${client.name || client.id} missed weeks ${lastWeek + 1} to ${weekNo}`
          );
        }
      }
    }

    return res.json({
      ok: true,
      nudged,
      reengaged,
      client_nudged: clientNudged
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
