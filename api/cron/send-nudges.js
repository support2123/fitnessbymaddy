const { supabase } = require('../_lib/supabase');
const { sendTemplate, maskPhone } = require('../_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const summary = {
    lead_nudges_sent: 0,
    leads_dropped: 0,
    checkin_nudges_sent: 0,
    errors: [],
  };

  try {
    const now = new Date();
    await nudgeNewLeads(now, summary);
    await dropStaleLeads(now, summary);
    await nudgeCheckins(now, summary);

    console.log('[send-nudges] Done —', JSON.stringify(summary));
    return res.status(200).json(summary);
  } catch (err) {
    console.error('[send-nudges] Unexpected error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

async function hasReplied(phone, sinceDate) {
  const { data } = await supabase
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'in')
    .gte('sent_at', sinceDate)
    .limit(1);
  return data && data.length > 0;
}

async function nudgeNewLeads(now, summary) {
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
  const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString();

  try {
    const { data: leads, error } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .gte('created_at', threeHoursAgo)
      .lte('created_at', twoHoursAgo);

    if (error || !leads || leads.length === 0) return;

    for (const lead of leads) {
      try {
        const replied = await hasReplied(lead.phone, lead.created_at);
        if (replied) continue;

        const alreadyNudged = await supabase
          .from('nudge_log')
          .select('id')
          .eq('phone', lead.phone)
          .eq('nudge_type', '2hr_nudge')
          .limit(1);
        if (alreadyNudged.data && alreadyNudged.data.length > 0) continue;

        const result = await sendTemplate(lead.phone, 'nudge_trial', [lead.name || 'there']);
        if (result.success) {
          await supabase.from('nudge_log').insert({
            phone: lead.phone,
            nudge_type: '2hr_nudge',
            sent_at: new Date().toISOString(),
          });
          summary.lead_nudges_sent++;
        }
      } catch (e) {
        summary.errors.push({ lead_id: lead.id, error: e.message });
      }
    }
  } catch (err) {
    summary.errors.push({ step: 'nudge_new_leads', error: err.message });
  }
}

async function dropStaleLeads(now, summary) {
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  try {
    const { data: leads, error } = await supabase
      .from('leads')
      .select('id, phone, created_at')
      .eq('status', 'new')
      .lt('created_at', twentyFourHoursAgo);

    if (error || !leads || leads.length === 0) return;

    for (const lead of leads) {
      try {
        const replied = await hasReplied(lead.phone, lead.created_at);
        if (replied) continue;

        await supabase
          .from('leads')
          .update({ status: 'dropped', updated_at: new Date().toISOString() })
          .eq('id', lead.id);

        console.log(`[send-nudges] Dropped lead ${maskPhone(lead.phone)}`);
        summary.leads_dropped++;
      } catch (e) {
        summary.errors.push({ lead_id: lead.id, error: e.message });
      }
    }
  } catch (err) {
    summary.errors.push({ step: 'drop_stale', error: err.message });
  }
}

async function nudgeCheckins(now, summary) {
  try {
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reminders, error } = await supabase
      .from('nudge_log')
      .select('*')
      .like('nudge_type', 'checkin_reminder_%')
      .gte('sent_at', threeDaysAgo);

    if (error || !reminders || reminders.length === 0) return;

    for (const reminder of reminders) {
      try {
        const sentAt = new Date(reminder.sent_at);
        const hoursSinceSent = (now - sentAt) / (1000 * 60 * 60);

        const is24hrWindow = hoursSinceSent >= 24 && hoursSinceSent < 25;
        const is48hrWindow = hoursSinceSent >= 48 && hoursSinceSent < 49;
        if (!is24hrWindow && !is48hrWindow) continue;

        const weekMatch = reminder.nudge_type.match(/checkin_reminder_w(\d+)/);
        if (!weekMatch) continue;
        const weekNo = parseInt(weekMatch[1], 10);

        const { data: client } = await supabase
          .from('clients')
          .select('id, phone, name')
          .eq('phone', reminder.phone)
          .eq('status', 'active')
          .single();
        if (!client) continue;

        const { data: submitted } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .limit(1);
        if (submitted && submitted.length > 0) continue;

        const nudgeType = is24hrWindow ? 'checkin_nudge_24h' : 'checkin_nudge_48h';

        const { data: alreadySent } = await supabase
          .from('nudge_log')
          .select('id')
          .eq('phone', reminder.phone)
          .eq('nudge_type', `${nudgeType}_w${weekNo}`)
          .limit(1);
        if (alreadySent && alreadySent.length > 0) continue;

        const formLink = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
        const result = await sendTemplate(client.phone, nudgeType, [client.name, String(weekNo), formLink]);

        if (result.success) {
          await supabase.from('nudge_log').insert({
            phone: client.phone,
            nudge_type: `${nudgeType}_w${weekNo}`,
            sent_at: new Date().toISOString(),
          });
          summary.checkin_nudges_sent++;
        }
      } catch (e) {
        summary.errors.push({ phone: reminder.phone, error: e.message });
      }
    }
  } catch (err) {
    summary.errors.push({ step: 'checkin_nudge', error: err.message });
  }
}
