const { supabase } = require('../lib/supabase');
const { sendTemplate, canSendMessage } = require('../lib/whatsapp');
const { isHinglish } = require('../lib/market');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;
  if (!isVercelCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: nudgeLeads, error } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('last_msg_at', sevenDaysAgo)
      .gte('last_msg_at', fourteenDaysAgo);

    if (error) {
      console.error('Nudge query error:', error.message);
      return res.status(500).json({ error: 'Query failed' });
    }

    let nudged = 0;
    let skipped = 0;

    for (const lead of nudgeLeads || []) {
      const canSend = await canSendMessage(lead.phone);
      if (!canSend) {
        skipped++;
        continue;
      }

      const hinglish = isHinglish(lead.market);

      await sendTemplate(lead.phone, 'nudge_trial', {
        name: lead.name || 'there',
        templateParams: hinglish
          ? [lead.name || 'there', 'Sirf $20 mein ek Zoom trial session try karo! Link: https://fitnessbymaddy.com/intake?lead=' + lead.id]
          : [lead.name || 'there', 'Try a $20 Zoom trial session! Link: https://fitnessbymaddy.com/intake?lead=' + lead.id]
      });

      nudged++;
    }

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: staleLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lte('last_msg_at', twentyFourHoursAgo)
      .lt('created_at', twentyFourHoursAgo);

    let dropped = 0;
    if (staleLeads?.length > 0) {
      const ids = staleLeads.map(l => l.id);
      await supabase.from('leads').update({ status: 'dropped' }).in('id', ids);
      dropped = ids.length;
    }

    const { data: pendingCheckins } = await supabase
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    let checkinNudged = 0;
    for (const client of pendingCheckins || []) {
      const weekNo = calculateWeekNo(client.program_started_at);
      if (weekNo < 1) continue;

      const { data: checkin } = await supabase
        .from('checkins')
        .select('id, form_submitted_at')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (checkin) continue;

      const { data: lastMsg } = await supabase
        .from('messages')
        .select('sent_at')
        .eq('phone', client.phone)
        .eq('direction', 'out')
        .order('sent_at', { ascending: false })
        .limit(1)
        .single();

      if (lastMsg) {
        const hoursSinceMsg = (Date.now() - new Date(lastMsg.sent_at)) / (1000 * 60 * 60);
        if (hoursSinceMsg >= 24 && hoursSinceMsg < 72) {
          const canSend = await canSendMessage(client.phone);
          if (canSend) {
            const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
            await sendTemplate(client.phone, 'checkin_reminder', {
              name: client.name || 'there',
              templateParams: [client.name || 'there', String(weekNo), checkinUrl]
            });
            checkinNudged++;
          }
        }
      }
    }

    return res.status(200).json({
      ok: true,
      leads_nudged: nudged,
      leads_skipped: skipped,
      leads_dropped: dropped,
      checkin_nudged: checkinNudged
    });
  } catch (err) {
    console.error('nudge-dropped cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateWeekNo(programStartedAt) {
  if (!programStartedAt) return 0;
  const start = new Date(programStartedAt);
  const now = new Date();
  const diffMs = now - start;
  return Math.ceil(Math.floor(diffMs / (1000 * 60 * 60 * 24)) / 7);
}
