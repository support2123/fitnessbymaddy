const { getSupabase } = require('../_lib/supabase');
const { sendText, canSendToLead } = require('../_lib/whatsapp');
const { detectMarket, jsonResponse, errorResponse } = require('../_lib/helpers');

const SITE = 'https://www.fitnessbymaddy.com';

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return errorResponse(res, 'GET or POST only', 405);
  }

  const authHeader = req.headers['authorization'];
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return errorResponse(res, 'Unauthorized', 401);
  }

  const db = getSupabase();
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  // Get dropped leads from 7-14 days ago who haven't opted out and haven't been nudged too many times
  const { data: droppedLeads, error } = await db
    .from('leads')
    .select('*')
    .eq('status', 'dropped')
    .eq('opted_out', false)
    .gte('dropped_at', fourteenDaysAgo.toISOString())
    .lte('dropped_at', sevenDaysAgo.toISOString())
    .lt('nudge_count', 2);

  if (error) {
    console.error('[Cron] Failed to fetch dropped leads:', error.message);
    return errorResponse(res, 'Database error', 500);
  }

  // Also get "new" leads who never replied (no activity in 24h)
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const { data: staleLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .eq('opted_out', false)
    .lte('last_msg_at', oneDayAgo.toISOString())
    .lt('nudge_count', 1);

  // Mark stale leads as dropped
  if (staleLeads && staleLeads.length > 0) {
    const staleIds = staleLeads.map(l => l.id);
    await db.from('leads').update({
      status: 'dropped',
      dropped_at: now.toISOString()
    }).in('id', staleIds);
  }

  let sent = 0;
  const allLeads = [...(droppedLeads || [])];

  for (const lead of allLeads) {
    const rateOk = await canSendToLead(lead.phone);
    if (!rateOk) continue;

    const market = detectMarket(lead.phone);
    const isHinglish = market === 'IN';
    const name = lead.name || '';

    const msg = isHinglish
      ? `Hey${name ? ' ' + name : ''}! 👋 Maddy ka $20 trial session abhi available hai — ek Zoom call mein apna customised plan milega.\n\nInterested? "trial" reply kar ya yahan click kar:\n${SITE}/intake?lead=${lead.id}`
      : `Hey${name ? ' ' + name : ''}! 👋 Maddy's $20 trial session is still available — get a customised plan in one Zoom call.\n\nInterested? Reply "trial" or click here:\n${SITE}/intake?lead=${lead.id}`;

    await sendText(lead.phone, msg);
    await db.from('leads').update({
      nudge_count: (lead.nudge_count || 0) + 1
    }).eq('id', lead.id);
    sent++;
  }

  console.log(`[Cron] Nudge dropped: ${sent} sent, ${staleLeads?.length || 0} stale marked`);

  return jsonResponse(res, {
    ok: true,
    nudged: sent,
    stale_marked: staleLeads?.length || 0
  });
};
