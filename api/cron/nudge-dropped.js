import supabase from '../lib/supabase.js';
import { sendText } from '../lib/whatsapp.js';
import { logMessage, canSendMessage } from '../lib/rate-limit.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('created_at', fourteenDaysAgo)
      .lte('created_at', sevenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ status: 'no_leads_to_nudge' });
    }

    let sent = 0;

    for (const lead of droppedLeads) {
      const allowed = await canSendMessage(lead.phone);
      if (!allowed) continue;

      const { count } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('template_name', 'reengagement_7d');

      if (count > 0) continue;

      const market = lead.market || 'GLOBAL';

      const msg = market === 'IN'
        ? `Hey ${lead.name || ''}! Maddy yahan se 👋 Pichli baar baat adhoori reh gayi. Abhi bhi fitness goals pe kaam karna hai? Maddy ka $20 trial session best starting point hai — ek Zoom call pe full workout + diet guidance.\n\nInterested? Bas "trial" bol do 💪`
        : `Hey ${lead.name || ''}! Maddy here 👋 We didn't get to finish our chat last time. Still working on your fitness goals? Maddy's $20 trial session is the best starting point — a full workout + nutrition guidance on one Zoom call.\n\nInterested? Just reply "trial" 💪`;

      await sendText(lead.phone, msg);
      await logMessage(lead.phone, 'out', msg, 'reengagement_7d');
      sent++;
    }

    const { data: pendingCheckins } = await supabase
      .from('clients')
      .select('id, phone, name, program_started_at, leads!clients_lead_id_fkey(market)')
      .eq('status', 'active');

    let checkinNudges = 0;

    for (const client of pendingCheckins || []) {
      const weekNo = Math.ceil(
        (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
      );

      const { data: checkin } = await supabase
        .from('checkins')
        .select('id, form_submitted_at')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (checkin) continue;

      const lastSunday = new Date();
      lastSunday.setDate(lastSunday.getDate() - lastSunday.getDay());
      lastSunday.setHours(3, 30, 0, 0);
      const hoursSinceSunday = (Date.now() - lastSunday.getTime()) / (1000 * 60 * 60);

      if (hoursSinceSunday >= 24 && hoursSinceSunday < 48) {
        const market = client.leads?.market || 'GLOBAL';
        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

        const msg = market === 'IN'
          ? `Reminder! 📋 Week ${weekNo} check-in abhi tak pending hai. Jaldi submit karo taaki Maddy tumhara next plan ready kar sake.\n\n${checkinUrl}`
          : `Reminder! 📋 Your Week ${weekNo} check-in is still pending. Submit it so Maddy can prepare your next plan.\n\n${checkinUrl}`;

        await sendText(client.phone, msg);
        await logMessage(client.phone, 'out', msg, 'checkin_nudge_24h');
        checkinNudges++;
      } else if (hoursSinceSunday >= 48 && hoursSinceSunday < 72) {
        const market = client.leads?.market || 'GLOBAL';
        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

        const msg = market === 'IN'
          ? `Last reminder! ⏰ Week ${weekNo} check-in miss ho jayega. 2 min lagega — submit karo aur track pe raho.\n\n${checkinUrl}`
          : `Last reminder! ⏰ You'll miss your Week ${weekNo} check-in. Takes 2 mins — submit now and stay on track.\n\n${checkinUrl}`;

        await sendText(client.phone, msg);
        await logMessage(client.phone, 'out', msg, 'checkin_nudge_48h');
        checkinNudges++;
      }
    }

    return res.status(200).json({ status: 'ok', reengaged: sent, checkin_nudges: checkinNudges });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
