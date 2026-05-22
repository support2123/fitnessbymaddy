import { getSupabase } from '../_lib/supabase.js';
import { sendWhatsApp } from '../_lib/whatsapp.js';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  const now = new Date();
  const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
  const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: newLeadsNudge } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lte('created_at', twoHoursAgo)
    .gte('created_at', twentyFourHoursAgo);

  let nudgedCount = 0;

  for (const lead of (newLeadsNudge || [])) {
    const { data: msgs } = await db
      .from('messages')
      .select('id')
      .eq('phone', lead.phone)
      .eq('template_name', 'nudge_trial')
      .limit(1);

    if (msgs && msgs.length > 0) continue;

    await sendWhatsApp(lead.phone, 'nudge_trial', [
      lead.name || 'there',
      'https://fitnessbymaddy.com/program-trial.html'
    ]);
    nudgedCount++;
  }

  const { data: staleLeads } = await db
    .from('leads')
    .select('id')
    .eq('status', 'new')
    .lte('created_at', twentyFourHoursAgo);

  let droppedCount = 0;
  for (const lead of (staleLeads || [])) {
    await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
    droppedCount++;
  }

  const { data: reEngageLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'dropped')
    .gte('last_msg_at', sevenDaysAgo);

  let reEngagedCount = 0;
  for (const lead of (reEngageLeads || [])) {
    const { data: reEngageMsgs } = await db
      .from('messages')
      .select('id')
      .eq('phone', lead.phone)
      .eq('template_name', 'reengage_7day')
      .limit(1);

    if (reEngageMsgs && reEngageMsgs.length > 0) continue;

    await sendWhatsApp(lead.phone, 'reengage_7day', [
      lead.name || 'there'
    ]);
    reEngagedCount++;
  }

  return res.json({
    ok: true,
    nudged: nudgedCount,
    dropped: droppedCount,
    reengaged: reEngagedCount
  });
}
