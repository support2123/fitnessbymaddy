const { getSupabase } = require('../lib/supabase');
const { sendTemplate, canSendToLead } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sb = getSupabase();
  const results = { nudged: 0, skipped: 0, errors: 0 };

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString();

    const { data: droppedLeads } = await sb
      .from('leads')
      .select('id, phone, name, market, program_interest')
      .eq('status', 'dropped')
      .gte('last_msg_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ message: 'No leads to nudge', results });
    }

    for (const lead of droppedLeads) {
      try {
        const { count } = await sb
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('phone', lead.phone)
          .eq('template_name', 'reengagement_7day');

        if (count > 0) {
          results.skipped++;
          continue;
        }

        const allowed = await canSendToLead(lead.phone);
        if (!allowed) {
          results.skipped++;
          continue;
        }

        await sendTemplate(lead.phone, 'reengagement_7day', [
          lead.name || 'there'
        ]);
        results.nudged++;

      } catch (err) {
        console.error('Nudge error:', err.message);
        results.errors++;
      }
    }

    const { data: scheduledNudges } = await sb
      .from('messages')
      .select('id, phone, template_name')
      .eq('status', 'scheduled')
      .lte('sent_at', new Date().toISOString());

    if (scheduledNudges) {
      for (const nudge of scheduledNudges) {
        try {
          const { data: checkinExists } = await sb
            .from('checkins')
            .select('id')
            .eq('client_id', nudge.phone)
            .limit(1)
            .maybeSingle();

          if (!checkinExists) {
            await sendTemplate(nudge.phone, nudge.template_name, []);
          }

          await sb.from('messages').update({ status: 'sent' }).eq('id', nudge.id);
        } catch (err) {
          console.error('Scheduled nudge error:', err.message);
        }
      }
    }

    return res.status(200).json({ success: true, results });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
