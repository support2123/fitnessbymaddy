const { supabase } = require('../../lib/supabase');
const { sendTemplate, sendText } = require('../../lib/whatsapp');
const { maskPhone, isHinglish } = require('../../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('created_at', sevenDaysAgo)
      .lte('last_msg_at', twoDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ message: 'No leads to re-engage' });
    }

    let reengaged = 0;

    for (const lead of droppedLeads) {
      const { data: alreadyNudged } = await supabase
        .from('nudges')
        .select('id')
        .eq('lead_id', lead.id)
        .eq('nudge_type', 'reengage_dropped')
        .maybeSingle();

      if (alreadyNudged) continue;

      await sendTemplate(lead.phone, 'nudge_trial', [
        lead.name || 'there'
      ], lead.name || 'there');

      await supabase.from('nudges').insert({
        lead_id: lead.id,
        nudge_type: 'reengage_dropped',
        sent_at: new Date().toISOString()
      });

      reengaged++;
    }

    const { data: pendingCheckins } = await supabase
      .from('nudges')
      .select('*, clients!nudges_client_id_fkey(id, phone, name, program)')
      .like('nudge_type', 'checkin_24h_week_%_scheduled')
      .gte('sent_at', twoDaysAgo);

    let checkinNudges = 0;
    if (pendingCheckins) {
      for (const nudge of pendingCheckins) {
        if (!nudge.clients) continue;
        const client = nudge.clients;
        const weekMatch = nudge.nudge_type.match(/week_(\d+)/);
        if (!weekMatch) continue;
        const weekNo = parseInt(weekMatch[1]);

        const { data: submitted } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .maybeSingle();

        if (submitted) {
          await supabase.from('nudges').delete().eq('id', nudge.id);
          continue;
        }

        const hoursOld = (Date.now() - new Date(nudge.sent_at).getTime()) / (60 * 60 * 1000);
        if (hoursOld >= 24 && hoursOld < 48) {
          const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
          await sendText(client.phone,
            `Reminder: ${client.name || 'Hey'}, your Week ${weekNo} check-in is still pending 📋\n\n${checkinUrl}\n\nQuick 2-min form — helps us fine-tune your program!`
          );
          await supabase.from('nudges').update({
            nudge_type: `checkin_48h_week_${weekNo}_scheduled`
          }).eq('id', nudge.id);
          checkinNudges++;
        } else if (hoursOld >= 48) {
          const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
          await sendText(client.phone,
            `Last reminder for Week ${weekNo} check-in ⏰\n\n${checkinUrl}\n\nFill it out so your next week's program stays on track!`
          );
          await supabase.from('nudges').delete().eq('id', nudge.id);
          checkinNudges++;
        }
      }
    }

    return res.status(200).json({
      message: `Re-engaged ${reengaged} leads, sent ${checkinNudges} check-in nudges`
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};
