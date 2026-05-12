const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { escalateToMaddy, maskPhone } = require('../_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getSupabase();

  try {
    // --- Nudge leads who haven't replied ---
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Leads who got welcome but no reply after 2 hours — send trial nudge
    const { data: staleLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo)
      .gte('created_at', twentyFourHoursAgo);

    let nudged = 0;

    if (staleLeads) {
      for (const lead of staleLeads) {
        const { count } = await db
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('phone', lead.phone)
          .eq('template_name', 'nudge_trial');

        if ((count || 0) === 0) {
          await sendWhatsApp(lead.phone, 'nudge_trial', {
            name: lead.name || 'there',
            templateParams: [lead.name || 'there'],
          });
          nudged++;
        }
      }
    }

    // Drop leads older than 24 hours with no reply
    const { data: deadLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twentyFourHoursAgo);

    let dropped = 0;
    if (deadLeads) {
      for (const lead of deadLeads) {
        const { count } = await db
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('phone', lead.phone)
          .eq('direction', 'in');

        const inboundCount = count || 0;
        if (inboundCount <= 1) {
          await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
          dropped++;
        }
      }
    }

    // --- Nudge clients with pending check-ins ---
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let checkinNudges = 0;
    let consecutiveMisses = 0;

    if (activeClients) {
      for (const client of activeClients) {
        const weekNo = calculateWeekNo(client.program_started_at);
        if (weekNo < 1) continue;

        const { data: checkin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .maybeSingle();

        if (!checkin) {
          const { data: prevCheckin } = await db
            .from('checkins')
            .select('id')
            .eq('client_id', client.id)
            .eq('week_no', weekNo - 1)
            .maybeSingle();

          if (!prevCheckin && weekNo > 1) {
            consecutiveMisses++;
            await escalateToMaddy(
              '2 consecutive missed check-ins',
              `Client: ${client.name} (${maskPhone(client.phone)})\nMissed: Week ${weekNo - 1} and ${weekNo}`
            );
            continue;
          }

          const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
          await sendWhatsApp(client.phone, 'checkin_reminder', {
            name: client.name,
            templateParams: [client.name, `${weekNo}`, checkinUrl],
          });
          checkinNudges++;
        }
      }
    }

    return res.status(200).json({
      status: 'ok',
      nudged,
      dropped,
      checkin_nudges: checkinNudges,
      consecutive_miss_escalations: consecutiveMisses,
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};

function calculateWeekNo(programStartedAt) {
  const start = new Date(programStartedAt);
  const now = new Date();
  const diffMs = now - start;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.ceil((diffDays + 1) / 7);
}
