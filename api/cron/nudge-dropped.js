const supabase = require('../../lib/supabase');
const { sendTemplate, canSendToLead } = require('../../lib/whatsapp');
const { maskPhone } = require('../../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeadsToNudge } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoDaysAgo)
      .gt('created_at', sevenDaysAgo);

    let nudged = 0;

    if (newLeadsToNudge) {
      for (const lead of newLeadsToNudge) {
        const rateOk = await canSendToLead(lead.phone);
        if (!rateOk) continue;

        const { count } = await supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .gte('sent_at', sevenDaysAgo);

        if (count >= 3) continue;

        await sendTemplate(lead.phone, 'nudge_trial', [
          lead.name || 'there'
        ]);
        nudged++;
        console.log(`[Nudge] Trial nudge sent to ${maskPhone(lead.phone)}`);
      }
    }

    const tooOld = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: expiredLeads } = await supabase
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lt('created_at', tooOld);

    let dropped = 0;
    if (expiredLeads) {
      for (const lead of expiredLeads) {
        await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    const { data: pendingCheckins } = await supabase
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    let checkinNudges = 0;
    if (pendingCheckins) {
      for (const client of pendingCheckins) {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((Date.now() - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSinceStart / 7);
        if (currentWeek < 1) continue;

        const { data: checkin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .single();

        if (checkin) continue;

        const dayOfWeek = new Date().getDay();
        if (dayOfWeek === 1 || dayOfWeek === 2) {
          await sendTemplate(client.phone, 'checkin_reminder', [
            client.name || 'there',
            String(currentWeek)
          ]);
          checkinNudges++;
        }
      }
    }

    return res.status(200).json({
      ok: true,
      nudged,
      dropped,
      checkin_nudges: checkinNudges
    });
  } catch (err) {
    console.error('[Cron/NudgeDropped] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
