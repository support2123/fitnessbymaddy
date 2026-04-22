const { supabase } = require('../lib/supabase');
const { sendTemplate, canSendMessage, isHinglish } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;
  if (!isVercelCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ message: 'No leads to re-engage', sent: 0 });
    }

    let sentCount = 0;

    for (const lead of droppedLeads) {
      const allowed = await canSendMessage(lead.phone);
      if (!allowed) continue;

      const { count } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('template_name', 'reengagement_v1');

      if (count && count >= 1) continue;

      const hinglish = isHinglish(lead.market || 'IN');
      await sendTemplate(lead.phone, 'reengagement_v1', [
        lead.name || 'there'
      ]);

      await supabase.from('leads').update({
        status: 'new',
        last_msg_at: new Date().toISOString()
      }).eq('id', lead.id);

      sentCount++;
    }

    return res.status(200).json({
      message: 'Re-engagement complete',
      sent: sentCount,
      total: droppedLeads.length
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron job failed' });
  }
};
