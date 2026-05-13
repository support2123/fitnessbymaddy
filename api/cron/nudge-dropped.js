import supabase from '../lib/supabase.js';
import { sendTemplate } from '../lib/whatsapp.js';
import { detectMarket, isHinglish } from '../lib/market.js';

const NUDGE_WINDOW_DAYS = 7;
const NUDGE_MIN_AGE_HOURS = 2;
const NUDGE_MAX_AGE_HOURS = 24;

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  try {
    const now = new Date();
    let nudged = 0;
    let dropped = 0;

    // Nudge leads who haven't replied in 2+ hours (but less than 24h)
    const twoHoursAgo = new Date(now - NUDGE_MIN_AGE_HOURS * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now - NUDGE_MAX_AGE_HOURS * 60 * 60 * 1000).toISOString();

    const { data: staleLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('last_msg_at', twentyFourHoursAgo);

    for (const lead of staleLeads || []) {
      const market = detectMarket(lead.phone);
      const hinglish = isHinglish(market);
      const trialUrl = 'https://www.fitnessbymaddy.com/program-trial.html';

      const msg = hinglish
        ? [`Hey! 👋 Abhi decide nahi kar pa rahe? Koi baat nahi! Pehle ek $20 trial session try karo Maddy ke saath.\n\n→ ${trialUrl}`]
        : [`Hey! 👋 Still deciding? No worries! Try a $20 trial session with Maddy first.\n\n→ ${trialUrl}`];

      await sendTemplate(lead.phone, 'nudge_trial', msg);
      nudged++;
    }

    // Drop leads older than 24 hours with no reply
    const { data: deadLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('last_msg_at', twentyFourHoursAgo);

    if (deadLeads && deadLeads.length > 0) {
      const ids = deadLeads.map(l => l.id);
      await supabase.from('leads')
        .update({ status: 'dropped' })
        .in('id', ids);
      dropped = ids.length;
    }

    // Re-engage dropped leads from 7 days ago (one-time re-engagement)
    const sevenDaysAgo = new Date(now - NUDGE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const eightDaysAgo = new Date(now - (NUDGE_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000);

    const { data: reengageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo.toISOString())
      .gt('last_msg_at', eightDaysAgo.toISOString());

    let reengaged = 0;
    for (const lead of reengageLeads || []) {
      const market = detectMarket(lead.phone);
      const hinglish = isHinglish(market);

      const msg = hinglish
        ? [`Hey ${lead.name || ''}! Maddy ka naya batch shuru ho raha hai. Abhi bhi interested ho toh reply karo — aapke liye special offer hai! 🔥`]
        : [`Hey ${lead.name || ''}! Maddy's new batch is starting soon. Still interested? Reply and we have a special offer for you! 🔥`];

      await sendTemplate(lead.phone, 'reengage_7day', msg);
      reengaged++;
    }

    return res.json({ success: true, nudged, dropped, reengaged });
  } catch (err) {
    console.error('Nudge cron error:', err);
    return res.status(500).json({ error: 'Cron failed' });
  }
}
