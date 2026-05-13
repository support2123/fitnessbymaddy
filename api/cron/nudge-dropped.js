const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, canSendMessage } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const now = new Date();

  // Re-engage dropped leads that were dropped 7+ days ago
  // Only re-engage once (check messages table)
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const { data: droppedLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'dropped')
    .lte('last_msg_at', sevenDaysAgo)
    .gte('last_msg_at', fourteenDaysAgo);

  let reengaged = 0;

  for (const lead of (droppedLeads || [])) {
    // Check if we already sent a re-engagement message
    const { data: existingMsg } = await db
      .from('messages')
      .select('id')
      .eq('phone', lead.phone)
      .eq('template_name', 'reengage_dropped')
      .limit(1);

    if (existingMsg?.length) continue;

    const allowed = await canSendMessage(lead.phone, false);
    if (!allowed) continue;

    await sendTemplate(lead.phone, 'reengage_dropped', [
      lead.name || 'there'
    ]);
    reengaged++;
  }

  return res.status(200).json({ reengaged, checked: droppedLeads?.length || 0 });
};
