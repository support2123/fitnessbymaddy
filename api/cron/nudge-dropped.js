const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { notifyMaddy } = require('../lib/escalation');
const { maskPhone } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = getSupabase();
  const now = new Date();
  const summary = {
    reengagement: { sent: 0, skipped: 0, errors: 0 },
    nudges: { first: 0, second: 0, escalated: 0, errors: 0 },
    consecutiveMisses: { escalated: 0 },
  };

  try {
    await reengageDroppedLeads(supabase, now, summary);
    await nudgePendingCheckins(supabase, now, summary);
    await escalateConsecutiveMisses(supabase, now, summary);

    return res.status(200).json(summary);
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

async function reengageDroppedLeads(supabase, now, summary) {
  const sevenDaysAgo = new Date(now - 7 * 86400000).toISOString();
  const fourteenDaysAgo = new Date(now - 14 * 86400000).toISOString();

  const { data: leads, error: fetchErr } = await supabase
    .from('leads')
    .select('id, name, phone, last_msg_at')
    .eq('status', 'dropped')
    .gt('last_msg_at', fourteenDaysAgo)
    .lt('last_msg_at', sevenDaysAgo);

  if (fetchErr || !leads || leads.length === 0) return;

  for (const lead of leads) {
    try {
      // Dedup: check if win_back_v1 already sent in last 7 days
      const { data: recent } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'win_back_v1')
        .gte('sent_at', sevenDaysAgo)
        .limit(1);

      if (recent && recent.length > 0) {
        summary.reengagement.skipped++;
        continue;
      }

      const result = await sendWhatsApp(lead.phone, 'win_back_v1', {
        templateParams: [lead.name || 'there'],
      });

      if (!result.success) {
        summary.reengagement.errors++;
        continue;
      }

      summary.reengagement.sent++;
    } catch (err) {
      console.error(`Re-engage error ${maskPhone(lead.phone)}:`, err.message);
      summary.reengagement.errors++;
    }
  }
}

async function nudgePendingCheckins(supabase, now, summary) {
  const { data: pending, error: fetchErr } = await supabase
    .from('checkins')
    .select('id, client_id, week_no, created_at')
    .is('form_submitted_at', null)
    .order('created_at', { ascending: true });

  if (fetchErr || !pending || pending.length === 0) return;

  const clientIds = [...new Set(pending.map((c) => c.client_id))];
  const { data: clients } = await supabase
    .from('clients')
    .select('id, name, phone')
    .in('id', clientIds)
    .eq('status', 'active');

  const clientMap = {};
  for (const c of clients || []) clientMap[c.id] = c;

  for (const checkin of pending) {
    const client = clientMap[checkin.client_id];
    if (!client) continue;

    const ageHours = (now - new Date(checkin.created_at)) / 3600000;

    try {
      if (ageHours >= 72) {
        // Escalate — dedup by checking messages for this template+phone in last 7 days
        const { data: recentEsc } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', client.phone)
          .eq('template_name', 'escalation_alert')
          .gte('sent_at', new Date(now - 7 * 86400000).toISOString())
          .limit(1);

        if (!recentEsc || recentEsc.length === 0) {
          await notifyMaddy(
            `Missed check-in: week ${checkin.week_no}`,
            `Client ${client.name || 'unknown'} (${maskPhone(client.phone)}) has not submitted week ${checkin.week_no} after 72+ hours.`
          );
          summary.nudges.escalated++;
        }
      } else if (ageHours >= 48) {
        const { data: recent } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', client.phone)
          .eq('direction', 'out')
          .eq('template_name', 'checkin_nudge_2')
          .gte('sent_at', new Date(now - 20 * 3600000).toISOString())
          .limit(1);

        if (recent && recent.length > 0) continue;

        const result = await sendWhatsApp(client.phone, 'checkin_nudge_2', {
          templateParams: [client.name || 'there', String(checkin.week_no)],
        });
        if (result.success) summary.nudges.second++;
        else summary.nudges.errors++;
      } else if (ageHours >= 24) {
        const { data: recent } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', client.phone)
          .eq('direction', 'out')
          .eq('template_name', 'checkin_nudge_1')
          .gte('sent_at', new Date(now - 20 * 3600000).toISOString())
          .limit(1);

        if (recent && recent.length > 0) continue;

        const result = await sendWhatsApp(client.phone, 'checkin_nudge_1', {
          templateParams: [client.name || 'there', String(checkin.week_no)],
        });
        if (result.success) summary.nudges.first++;
        else summary.nudges.errors++;
      }
    } catch (err) {
      console.error(`Nudge error ${maskPhone(client.phone)}:`, err.message);
      summary.nudges.errors++;
    }
  }
}

async function escalateConsecutiveMisses(supabase, now, summary) {
  const cutoff = new Date(now - 72 * 3600000).toISOString();

  const { data: missed } = await supabase
    .from('checkins')
    .select('client_id, week_no')
    .is('form_submitted_at', null)
    .lt('created_at', cutoff)
    .order('client_id').order('week_no');

  if (!missed || missed.length < 2) return;

  const byClient = {};
  for (const ci of missed) {
    if (!byClient[ci.client_id]) byClient[ci.client_id] = [];
    byClient[ci.client_id].push(ci.week_no);
  }

  for (const [clientId, weeks] of Object.entries(byClient)) {
    const sorted = [...new Set(weeks)].sort((a, b) => a - b);
    let hasConsecutive = false;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] === sorted[i - 1] + 1) { hasConsecutive = true; break; }
    }
    if (!hasConsecutive) continue;

    try {
      const { data: client } = await supabase
        .from('clients')
        .select('id, name, phone')
        .eq('id', clientId)
        .single();
      if (!client) continue;

      // Dedup: check recent escalation for this client
      const { data: recentEsc } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', client.phone)
        .eq('template_name', 'system_alert')
        .gte('sent_at', new Date(now - 7 * 86400000).toISOString())
        .limit(1);

      if (recentEsc && recentEsc.length > 0) continue;

      await notifyMaddy(
        '2 consecutive missed check-ins',
        `Client ${client.name || 'unknown'} (${maskPhone(client.phone)}) missed weeks: ${sorted.join(', ')}. Follow-up recommended.`
      );
      summary.consecutiveMisses.escalated++;
    } catch (err) {
      console.error(`Consecutive miss escalation error:`, err.message);
    }
  }
}
