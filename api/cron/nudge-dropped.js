const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;

  if (!isVercelCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: nudgeableLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('last_msg_at', sevenDaysAgo)
      .gte('last_msg_at', fourteenDaysAgo);

    if (!nudgeableLeads || nudgeableLeads.length === 0) {
      return res.status(200).json({ ok: true, message: 'No leads to nudge', nudged: 0 });
    }

    let nudged = 0;

    for (const lead of nudgeableLeads) {
      const { count } = await db
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('template_name', 'nudge_trial');

      if (count && count >= 2) continue;

      await sendWhatsApp(lead.phone, 'nudge_trial', {
        name: lead.name || 'there',
        _isClient: false
      });

      nudged++;
    }

    const { data: pendingCheckins } = await db
      .from('clients')
      .select('id, phone, name, program_started_at, program')
      .eq('status', 'active');

    let checkinNudged = 0;

    if (pendingCheckins) {
      for (const client of pendingCheckins) {
        const weekNo = calculateWeekNo(client.program_started_at);
        if (weekNo < 1) continue;

        const { data: checkin } = await db
          .from('checkins')
          .select('id, form_submitted_at')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .limit(1)
          .single();

        if (checkin) continue;

        const { data: lastReminder } = await db
          .from('messages')
          .select('sent_at')
          .eq('phone', client.phone)
          .eq('template_name', 'checkin_reminder')
          .order('sent_at', { ascending: false })
          .limit(1)
          .single();

        if (!lastReminder) continue;

        const reminderAge = Date.now() - new Date(lastReminder.sent_at).getTime();
        const ONE_DAY = 24 * 60 * 60 * 1000;
        const TWO_DAYS = 2 * ONE_DAY;

        if (reminderAge > ONE_DAY && reminderAge < TWO_DAYS) {
          const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
          await sendWhatsApp(client.phone, 'checkin_nudge', {
            link: checkinUrl,
            name: client.name || 'there',
            _isClient: true
          });
          checkinNudged++;
        }
      }
    }

    return res.status(200).json({
      ok: true,
      leads_nudged: nudged,
      checkin_nudged: checkinNudged
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function calculateWeekNo(startedAt) {
  if (!startedAt) return 0;
  const start = new Date(startedAt);
  const now = new Date();
  return Math.ceil((now - start) / (7 * 24 * 60 * 60 * 1000));
}
