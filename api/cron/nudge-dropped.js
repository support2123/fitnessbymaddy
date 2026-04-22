const { supabase } = require('../_lib/supabase');
const { sendWhatsApp, notifyMaddy, maskPhone } = require('../_lib/whatsapp');
const { json } = require('../_lib/helpers');

module.exports = async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return json(res, 401, { error: 'Unauthorized' });
  }

  const now = new Date();

  // --- NUDGE 1: Leads who haven't replied in 2 hours (new leads only) ---
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
  const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString();

  const { data: staleNewLeads } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lte('last_msg_at', twoHoursAgo)
    .gte('last_msg_at', fourHoursAgo);

  let nudged2hr = 0;
  for (const lead of staleNewLeads || []) {
    const isHinglish = (lead.market || 'IN') === 'IN';
    const msg = isHinglish
      ? `Hey! 👋 Maddy ka $20 trial session try kar — ek Zoom call mein samajh aa jayega kaise kaam karte hain.\n\n` +
        `👉 https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}\n\n` +
        `No commitment. Bas ek session try karo!`
      : `Hey! 👋 Try Maddy's $20 trial session — one Zoom call to see how it all works.\n\n` +
        `👉 https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}\n\n` +
        `No commitment. Just one session to try!`;

    await sendWhatsApp({ phone: lead.phone, body: msg, templateName: 'nudge_trial' });
    nudged2hr++;
  }

  // --- NUDGE 2: Drop leads with no reply in 24 hours ---
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const { data: deadLeads } = await supabase
    .from('leads')
    .select('id, phone')
    .eq('status', 'new')
    .lte('last_msg_at', oneDayAgo);

  let dropped = 0;
  for (const lead of deadLeads || []) {
    await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
    dropped++;
  }

  // --- NUDGE 3: Clients with pending check-ins (24hr and 48hr) ---
  const { data: activeClients } = await supabase
    .from('clients')
    .select('*')
    .eq('status', 'active');

  let checkinNudges = 0;
  for (const client of activeClients || []) {
    const startDate = new Date(client.program_started_at);
    const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
    const weekNo = Math.max(1, Math.ceil(daysSinceStart / 7));
    const dayOfWeek = now.getDay();

    if (dayOfWeek !== 1 && dayOfWeek !== 2) continue;

    const { data: checkin } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .limit(1)
      .single();

    if (checkin) continue;

    const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
    const msg = `⏰ Reminder: Week ${weekNo} check-in is still pending!\n\n👉 ${checkinUrl}\n\nQuick 2-minute form — helps us keep your program on track.`;
    await sendWhatsApp({ phone: client.phone, body: msg });
    checkinNudges++;
  }

  // --- ESCALATION: 2 consecutive missed check-ins ---
  for (const client of activeClients || []) {
    const startDate = new Date(client.program_started_at);
    const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
    const currentWeek = Math.max(1, Math.ceil(daysSinceStart / 7));

    if (currentWeek < 3) continue;

    const { data: recent } = await supabase
      .from('checkins')
      .select('week_no')
      .eq('client_id', client.id)
      .order('week_no', { ascending: false })
      .limit(2);

    const submittedWeeks = (recent || []).map(c => c.week_no);
    if (!submittedWeeks.includes(currentWeek - 1) && !submittedWeeks.includes(currentWeek - 2)) {
      await supabase.from('escalations').insert({
        phone: client.phone,
        client_id: client.id,
        reason: '2 consecutive missed check-ins',
      });
      await notifyMaddy(
        '2 missed check-ins',
        `Client: ${maskPhone(client.phone)} (${client.name || 'N/A'})\nMissed weeks: ${currentWeek - 2} and ${currentWeek - 1}`
      );
    }
  }

  // --- RE-ENGAGE: Dropped leads after 7 days (one-time) ---
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();

  const { data: reEngageLeads } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'dropped')
    .lte('last_msg_at', sevenDaysAgo)
    .gte('last_msg_at', eightDaysAgo);

  let reEngaged = 0;
  for (const lead of reEngageLeads || []) {
    const isHinglish = (lead.market || 'IN') === 'IN';
    const msg = isHinglish
      ? `Hey ${lead.name || ''}! 👋 Bas ek baar check karna tha — abhi bhi fitness goal pe kaam karna hai? Maddy ke programs mein limited spots hain. Reply kar agar interested hai!`
      : `Hey ${lead.name || ''}! 👋 Just checking in — still working on your fitness goal? Limited spots in Maddy's programs. Reply if interested!`;
    await sendWhatsApp({ phone: lead.phone, body: msg });
    reEngaged++;
  }

  return json(res, 200, {
    nudged_2hr: nudged2hr,
    dropped,
    checkin_nudges: checkinNudges,
    re_engaged: reEngaged,
  });
};
