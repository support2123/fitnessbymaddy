import supabase from '../../lib/supabase.js';
import { sendTemplate, notifyMaddy } from '../../lib/whatsapp.js';
import { isHinglish, detectMarket, maskPhone } from '../../lib/market.js';

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const twoDaysAgo = new Date();
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

  const { data: droppedLeads } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'dropped')
    .gte('created_at', sevenDaysAgo.toISOString())
    .lte('last_msg_at', twoDaysAgo.toISOString());

  let nudged = 0;

  if (droppedLeads) {
    for (const lead of droppedLeads) {
      const market = detectMarket(lead.phone);
      const template = isHinglish(market) ? 'nudge_trial' : 'nudge_trial_en';
      const result = await sendTemplate(lead.phone, template, [lead.name || 'there']);
      if (result.ok) nudged++;
    }
  }

  const { data: activeClients } = await supabase
    .from('clients')
    .select('*')
    .eq('status', 'active');

  let escalations = 0;

  if (activeClients) {
    for (const client of activeClients) {
      const { data: recentCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      const currentWeek = calculateWeekNo(client.program_started_at);

      if (currentWeek >= 3 && (!recentCheckins || recentCheckins.length === 0)) {
        await notifyMaddy(
          '2 consecutive missed check-ins',
          `Client: ${client.name || maskPhone(client.phone)}, Current week: ${currentWeek}`
        );
        escalations++;
        continue;
      }

      if (recentCheckins && recentCheckins.length > 0) {
        const latestWeek = recentCheckins[0].week_no;
        if (currentWeek - latestWeek >= 2) {
          await notifyMaddy(
            '2 consecutive missed check-ins',
            `Client: ${client.name || maskPhone(client.phone)}, Last check-in: Week ${latestWeek}, Current: Week ${currentWeek}`
          );
          escalations++;
        }
      }

      const weekNo = currentWeek;
      const { data: thisWeek } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (!thisWeek && currentWeek > 1) {
        const daysSinceSunday = getDaysSinceSunday();
        if (daysSinceSunday === 1 || daysSinceSunday === 2) {
          const baseUrl = process.env.VERCEL_URL
            ? `https://${process.env.VERCEL_URL}`
            : 'https://www.fitnessbymaddy.com';
          const formUrl = `${baseUrl}/checkin.html?c=${client.id}&w=${weekNo}`;

          const market = detectMarket(client.phone);
          const hinglish = isHinglish(market);
          const msg = hinglish
            ? `Reminder: Week ${weekNo} ka check-in abhi tak nahi hua. Yeh form fill karo: ${formUrl}`
            : `Reminder: Your Week ${weekNo} check-in is still pending. Fill it out here: ${formUrl}`;

          const { sendText } = await import('../../lib/whatsapp.js');
          await sendText(client.phone, msg);
        }
      }
    }
  }

  return res.status(200).json({ ok: true, nudged, escalations });
}

function calculateWeekNo(startedAt) {
  const start = new Date(startedAt);
  const now = new Date();
  return Math.ceil((now - start) / (7 * 24 * 60 * 60 * 1000)) || 1;
}

function getDaysSinceSunday() {
  return new Date().getDay();
}
