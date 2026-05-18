const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { isHinglishMarket, maskPhone, jsonResponse, errorResponse } = require('../_lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return errorResponse(res, 'GET or POST only', 405);
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return errorResponse(res, 'Unauthorized', 401);
  }

  const db = getSupabase();
  const now = new Date();

  // Nudge new leads who haven't replied in 2 hours
  const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
  const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

  const { data: staleNewLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('created_at', twoHoursAgo)
    .gt('created_at', twentyFourHoursAgo);

  let nudgedCount = 0;
  let droppedCount = 0;

  if (staleNewLeads) {
    for (const lead of staleNewLeads) {
      const { count } = await db
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .ilike('template_name', '%nudge%');

      if ((count || 0) === 0) {
        const hinglish = isHinglishMarket(lead.market || 'GLOBAL');
        if (hinglish) {
          await sendWhatsApp(lead.phone, 'nudge_trial', [
            '$20 mein ek trial Zoom session try karo — link: https://www.fitnessbymaddy.com/shred.html'
          ]);
        } else {
          await sendWhatsApp(lead.phone, 'nudge_trial', [
            'Try a $20 trial Zoom session — link: https://www.fitnessbymaddy.com/shred.html'
          ]);
        }
        nudgedCount++;
        console.log(`Nudged: ${maskPhone(lead.phone)}`);
      }
    }
  }

  // Drop leads with no reply after 24 hours
  const { data: expiredLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('created_at', twentyFourHoursAgo);

  if (expiredLeads) {
    for (const lead of expiredLeads) {
      await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
      droppedCount++;
      console.log(`Dropped: ${maskPhone(lead.phone)}`);
    }
  }

  // Re-engage dropped leads once after 7 days (but only once)
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const eightDaysAgo = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString();

  const { data: reEngageLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'dropped')
    .lt('last_msg_at', sevenDaysAgo)
    .gt('last_msg_at', eightDaysAgo);

  let reEngagedCount = 0;

  if (reEngageLeads) {
    for (const lead of reEngageLeads) {
      const { count } = await db
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .ilike('template_name', '%reengage%');

      if ((count || 0) === 0) {
        await sendWhatsApp(lead.phone, 'reengage_7day', [
          lead.name || 'there',
        ]);
        reEngagedCount++;
      }
    }
  }

  // Nudge active clients with pending check-ins (+24h and +48h)
  const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
  const twoDaysAgo = new Date(now - 48 * 60 * 60 * 1000);

  const { data: activeClients } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active');

  let clientNudges = 0;

  if (activeClients) {
    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.max(1, Math.ceil(daysSinceStart / 7));

      const { data: checkin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .maybeSingle();

      if (checkin) continue;

      const dayOfWeek = now.getDay();
      if (dayOfWeek === 1 || dayOfWeek === 2) {
        const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
        await sendWhatsApp(client.phone, 'checkin_reminder', [
          client.name || 'there',
          checkinUrl,
        ]);
        clientNudges++;
      }
    }
  }

  return jsonResponse(res, {
    ok: true,
    nudged: nudgedCount,
    dropped: droppedCount,
    re_engaged: reEngagedCount,
    client_nudges: clientNudges,
  });
};
