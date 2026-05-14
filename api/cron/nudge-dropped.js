import supabase from '../lib/supabase.js';
import { sendText } from '../lib/whatsapp.js';
import { isHinglishMarket } from '../lib/market.js';
import { BASE_URL } from '../lib/constants.js';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isService = authHeader === `Bearer ${process.env.SUPABASE_SERVICE_KEY}`;
  if (!isCron && !isService) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeadsToNudge } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', twentyFourHoursAgo);

    let nudged = 0;
    let dropped = 0;

    if (newLeadsToNudge) {
      for (const lead of newLeadsToNudge) {
        const { count } = await supabase
          .from('messages')
          .select('*', { count: 'exact', head: true })
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .ilike('body', '%trial%');

        if (count && count > 0) continue;

        const hinglish = isHinglishMarket(lead.market);
        const trialUrl = `${BASE_URL}/shred.html`;

        const msg = hinglish
          ? `Hey ${lead.name || ''}! Abhi tak decide nahi hua? Ek $20 trial session try karo — Maddy ke saath live Zoom call. No commitment.\n\nDetails: ${trialUrl}`
          : `Hey ${lead.name || ''}! Haven't decided yet? Try a $20 trial session — a live Zoom call with Maddy. No commitment.\n\nDetails: ${trialUrl}`;

        await sendText(lead.phone, msg);
        nudged++;
      }
    }

    const { data: staleLeads } = await supabase
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lt('created_at', twentyFourHoursAgo)
      .gt('created_at', sevenDaysAgo);

    if (staleLeads) {
      for (const lead of staleLeads) {
        const { data: replies } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .gt('sent_at', lead.created_at)
          .limit(1);

        if (!replies || replies.length === 0) {
          await supabase.from('leads')
            .update({ status: 'dropped' })
            .eq('id', lead.id);
          dropped++;
        }
      }
    }

    const sevenDayReengage = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const eightDaysAgo = new Date(now - 8 * 24 * 60 * 60 * 1000);

    const { data: reengageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gt('last_msg_at', eightDaysAgo.toISOString())
      .lt('last_msg_at', sevenDayReengage.toISOString());

    let reengaged = 0;
    if (reengageLeads) {
      for (const lead of reengageLeads) {
        const hinglish = isHinglishMarket(lead.market);
        const msg = hinglish
          ? `Hey ${lead.name || ''}! Maddy ka team — last chance 🔥 Agar abhi bhi interested ho toh bata do, hum tumhare liye best program suggest karenge.`
          : `Hey ${lead.name || ''}! Maddy's team here — last chance 🔥 If you're still interested, let us know and we'll suggest the best program for you.`;

        await sendText(lead.phone, msg);
        reengaged++;
      }
    }

    return res.status(200).json({ nudged, dropped, reengaged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
}
