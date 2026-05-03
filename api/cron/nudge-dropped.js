const { getSupabase } = require('../lib/supabase');
const { sendTemplate, canSendMessage, maskPhone } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const now = new Date();

    // --- PART 1: Nudge new leads who haven't replied (2hr mark) ---
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const { data: staleNewLeads } = await db
      .from('leads')
      .select('id, phone, name, market, created_at')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', new Date(now - 24 * 60 * 60 * 1000).toISOString());

    let nudged = 0;
    for (const lead of (staleNewLeads || [])) {
      if (await canSendMessage(lead.phone)) {
        await sendTemplate(lead.phone, 'nudge_trial', [
          lead.name || 'there',
          'https://fitnessbymaddy.com/program-trial.html'
        ]);
        nudged++;
      }
    }

    // --- PART 2: Mark 24hr no-reply as dropped ---
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    await db
      .from('leads')
      .update({ status: 'dropped' })
      .eq('status', 'new')
      .lt('created_at', oneDayAgo);

    // --- PART 3: Check-in nudges (+24hr, +48hr) ---
    const { data: activeClients } = await db
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    let checkinNudges = 0;
    for (const client of (activeClients || [])) {
      const startDate = new Date(client.program_started_at);
      const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

      const { data: checkin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (!checkin && weekNo > 0) {
        // Check how many consecutive misses
        const { data: lastCheckin } = await db
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(1)
          .single();

        const missedWeeks = lastCheckin ? weekNo - lastCheckin.week_no : weekNo;

        if (missedWeeks >= 2) {
          await escalateToMaddy('2 consecutive missed check-ins', {
            phone: maskPhone(client.phone),
            details: `${client.name || 'Client'} missed ${missedWeeks} weeks`
          });
        } else if (await canSendMessage(client.phone)) {
          const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
          await sendTemplate(client.phone, 'checkin_nudge', [
            client.name || 'there',
            checkinUrl
          ]);
          checkinNudges++;
        }
      }
    }

    return res.status(200).json({
      message: 'Nudge cron complete',
      nudged_leads: nudged,
      checkin_nudges: checkinNudges
    });

  } catch (err) {
    console.error('[Cron Nudge] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
