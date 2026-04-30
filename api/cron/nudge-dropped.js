const { getSupabase } = require('../lib/supabase');
const { sendTemplate, sendText, canSendToLead } = require('../lib/whatsapp');

const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    // Nudge new leads who haven't replied (2hr mark)
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const { data: staleNewLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .is('program_interest', null);

    let nudged = 0;
    if (staleNewLeads) {
      for (const lead of staleNewLeads) {
        if (!(await canSendToLead(lead.phone))) continue;

        await sendTemplate(lead.phone, 'nudge_trial', [lead.name || 'there']);
        nudged++;
      }
    }

    // Mark as dropped after 24hrs of no response
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const { data: deadLeads } = await db
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('created_at', oneDayAgo)
      .is('program_interest', null);

    let dropped = 0;
    if (deadLeads) {
      for (const lead of deadLeads) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    // Re-engage dropped leads at 7-day mark (one-time)
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString();
    const { data: reEngageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gt('last_msg_at', eightDaysAgo)
      .lt('last_msg_at', sevenDaysAgo);

    let reEngaged = 0;
    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        if (!(await canSendToLead(lead.phone))) continue;

        await sendTemplate(lead.phone, 'reengage_7day', [lead.name || 'there']);
        reEngaged++;
      }
    }

    // Nudge active clients with pending check-ins (+24hr and +48hr)
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let clientNudged = 0;
    if (activeClients) {
      for (const client of activeClients) {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.ceil(daysSinceStart / 7);

        const { data: checkin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (checkin) continue;

        const dayOfWeek = now.getDay(); // 0=Sun
        // Nudge on Monday (1 day after Sunday send) and Tuesday (2 days)
        if (dayOfWeek === 1 || dayOfWeek === 2) {
          const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
          await sendText(
            client.phone,
            `Hey ${client.name || 'there'}, just a reminder to submit your Week ${weekNo} check-in: ${checkinUrl} 📊`
          );
          clientNudged++;
        }

        // 2 consecutive missed check-ins → escalate
        if (weekNo >= 2) {
          const { data: prevCheckin } = await db
            .from('checkins')
            .select('id')
            .eq('client_id', client.id)
            .eq('week_no', weekNo - 1)
            .single();

          if (!prevCheckin && !checkin) {
            await sendText(
              MADDY_PHONE,
              `⚠️ ${client.name || client.phone} has missed 2 consecutive check-ins (Week ${weekNo - 1} & ${weekNo}). May need a personal reach-out.`
            );
          }
        }
      }
    }

    return res.json({
      ok: true,
      nudged,
      dropped,
      re_engaged: reEngaged,
      client_nudged: clientNudged,
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
