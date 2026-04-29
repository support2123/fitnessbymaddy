const { getSupabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { maskPhone } = require('../../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: nudgeLeads } = await db
      .from('leads')
      .select('id, phone, name, market, last_msg_at')
      .eq('status', 'new')
      .gte('last_msg_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    let nudged = 0;

    if (nudgeLeads) {
      for (const lead of nudgeLeads) {
        const { data: recentMsg } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'nudge_trial')
          .maybeSingle();

        if (recentMsg) continue;

        await sendTemplate(lead.phone, 'nudge_trial', [
          lead.name || 'there',
          'https://fitnessbymaddy.com/program-trial.html',
        ]);

        nudged++;
        console.log(`[NUDGE] Sent trial nudge to ${maskPhone(lead.phone)}`);
      }
    }

    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

    const { data: staleLeads } = await db
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lte('last_msg_at', oneDayAgo);

    let dropped = 0;
    if (staleLeads) {
      for (const lead of staleLeads) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    const { data: pendingCheckins } = await db
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    let checkinNudges = 0;
    if (pendingCheckins) {
      for (const client of pendingCheckins) {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.ceil(daysSinceStart / 7);

        const { data: checkin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .maybeSingle();

        if (checkin) continue;

        const dayOfWeek = now.getDay();
        if (dayOfWeek === 1 || dayOfWeek === 2) {
          await sendTemplate(client.phone, 'checkin_reminder', [
            client.name || 'there',
            String(weekNo),
            `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`,
          ]);
          checkinNudges++;
        }
      }
    }

    return res.status(200).json({
      ok: true,
      nudged,
      dropped,
      checkin_nudges: checkinNudges,
    });
  } catch (err) {
    console.error('[NUDGE CRON ERROR]', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
