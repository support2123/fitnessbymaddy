const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp, maskPhone } = require('../../lib/whatsapp');
const { canSendMessage, logMessage } = require('../../lib/rate-limit');

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  const cronSecret = req.headers['x-vercel-cron'];
  if (!cronSecret && authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = getSupabase();
  const now = new Date();

  const { data: newLeads } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('created_at', new Date(now - TWO_HOURS_MS).toISOString())
    .gt('created_at', new Date(now - TWENTY_FOUR_HOURS_MS).toISOString());

  let nudgeSent = 0;
  let droppedCount = 0;

  if (newLeads) {
    for (const lead of newLeads) {
      const ageMs = now - new Date(lead.created_at);
      const allowed = await canSendMessage(lead.phone);

      if (ageMs >= TWENTY_FOUR_HOURS_MS) {
        await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        droppedCount++;
        continue;
      }

      if (ageMs >= TWO_HOURS_MS && allowed) {
        await sendWhatsApp(lead.phone, 'nudge_trial', {
          name: lead.name || 'there',
          templateParams: [lead.name || 'there', '$20', 'https://www.fitnessbymaddy.com/program-trial.html']
        });
        await logMessage(lead.phone, 'out', 'Trial nudge', 'nudge_trial');
        nudgeSent++;
      }
    }
  }

  const { data: staleNewLeads } = await supabase
    .from('leads')
    .select('id')
    .eq('status', 'new')
    .lt('created_at', new Date(now - TWENTY_FOUR_HOURS_MS).toISOString());

  if (staleNewLeads) {
    for (const lead of staleNewLeads) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
      droppedCount++;
    }
  }

  const sevenDaysAgo = new Date(now - SEVEN_DAYS_MS).toISOString();
  const fourteenDaysAgo = new Date(now - 2 * SEVEN_DAYS_MS).toISOString();

  const { data: reEngageLeads } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'dropped')
    .gt('created_at', fourteenDaysAgo)
    .lt('created_at', sevenDaysAgo);

  let reEngaged = 0;
  if (reEngageLeads) {
    for (const lead of reEngageLeads) {
      const allowed = await canSendMessage(lead.phone);
      if (!allowed) continue;

      const { data: alreadySent } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 'reengage_7day')
        .limit(1);

      if (alreadySent && alreadySent.length > 0) continue;

      await sendWhatsApp(lead.phone, 'reengage_7day', {
        name: lead.name || 'there',
        templateParams: [lead.name || 'there']
      });
      await logMessage(lead.phone, 'out', '7-day re-engage', 'reengage_7day');
      reEngaged++;
    }
  }

  const { data: pendingCheckins } = await supabase
    .from('clients')
    .select('id, phone, name, program_started_at')
    .eq('status', 'active');

  let checkinNudged = 0;
  if (pendingCheckins) {
    for (const client of pendingCheckins) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      const { data: checkin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1)
        .single();

      if (checkin) continue;

      const dayOfWeek = now.getDay();
      if (dayOfWeek === 1 || dayOfWeek === 2) {
        const allowed = await canSendMessage(client.phone, true);
        if (!allowed) continue;

        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://www.fitnessbymaddy.com';
        const checkinUrl = `${baseUrl}/checkin.html?c=${client.id}&w=${weekNo}`;

        await sendWhatsApp(client.phone, 'checkin_nudge', {
          name: client.name || 'there',
          templateParams: [client.name || 'there', String(weekNo), checkinUrl]
        });
        await logMessage(client.phone, 'out', `Check-in nudge W${weekNo}`, 'checkin_nudge');
        checkinNudged++;
      }
    }
  }

  console.log(`Nudge cron: ${nudgeSent} nudged, ${droppedCount} dropped, ${reEngaged} re-engaged, ${checkinNudged} checkin nudges`);
  return res.status(200).json({
    success: true,
    nudgeSent,
    droppedCount,
    reEngaged,
    checkinNudged
  });
};
