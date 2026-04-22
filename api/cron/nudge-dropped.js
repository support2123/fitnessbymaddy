const { supabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization || '';
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.SUPABASE_SERVICE_KEY}`;

  if (!isVercelCron && !isInternal && req.method !== 'GET') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Re-engage leads dropped exactly 7 days ago (one-time nudge)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);

    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', eightDaysAgo.toISOString())
      .lte('last_msg_at', sevenDaysAgo.toISOString());

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ action: 'no_dropped_leads' });
    }

    const results = [];

    for (const lead of droppedLeads) {
      const { count } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('template_name', 'reengagement_v1');

      if (count > 0) {
        results.push({ phone_masked: maskPhone(lead.phone), action: 'already_nudged' });
        continue;
      }

      const hinglish = isHinglish(lead.market);

      await sendWhatsApp(lead.phone, 'reengagement_v1', [
        lead.name || 'there',
        'https://www.fitnessbymaddy.com/intake?lead=' + lead.id,
      ]);

      results.push({ phone_masked: maskPhone(lead.phone), action: 'reengaged' });
    }

    // Also send nudges for pending check-ins (24hr and 48hr)
    await nudgePendingCheckins();

    return res.status(200).json({ ok: true, processed: results.length, results });
  } catch (err) {
    console.error('Nudge cron error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function nudgePendingCheckins() {
  const { data: scheduled } = await supabase
    .from('messages')
    .select('*')
    .eq('status', 'scheduled')
    .eq('template_name', 'checkin_nudge_scheduled')
    .lte('sent_at', new Date().toISOString());

  if (!scheduled || scheduled.length === 0) return;

  for (const msg of scheduled) {
    const weekMatch = msg.body.match(/week (\d+)/);
    const weekNo = weekMatch ? parseInt(weekMatch[1]) : null;

    if (!weekNo) continue;

    const { data: client } = await supabase
      .from('clients')
      .select('id, name')
      .eq('phone', msg.phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (!client) continue;

    const { data: checkin } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .limit(1);

    if (checkin && checkin.length > 0) {
      await supabase.from('messages').update({ status: 'skipped' }).eq('id', msg.id);
      continue;
    }

    const formUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

    await sendWhatsApp(msg.phone, 'checkin_reminder_v1', [
      client.name || 'Champion',
      weekNo.toString(),
      formUrl,
    ]);

    await supabase.from('messages').update({ status: 'sent' }).eq('id', msg.id);
  }
}

function maskPhone(phone) {
  const { maskPhone } = require('../../lib/market');
  return maskPhone(phone);
}
