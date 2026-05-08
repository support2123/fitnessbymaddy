import { getSupabase } from '../../lib/supabase.js';
import { sendWhatsApp } from '../../lib/whatsapp.js';
import { detectMarket, isHinglish } from '../../lib/market.js';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const results = { nudged_new: 0, nudged_dropped: 0, errors: 0 };

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeadsNeedNudge } = await db
      .from('leads')
      .select('id, phone, name, market')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('created_at', twentyFourHoursAgo);

    for (const lead of (newLeadsNeedNudge || [])) {
      try {
        const market = lead.market || detectMarket(lead.phone);
        const body = isHinglish(market)
          ? "Hey! 👋 Maddy ki team se — humara $20 Zoom trial try karo?\n\nEk session mein pata chalega ye sahi hai ya nahi: https://fitnessbymaddy.com/intake?trial=true"
          : "Hey! 👋 From Maddy's team — want to try our $20 Zoom trial?\n\nOne session to see if this is right for you: https://fitnessbymaddy.com/intake?trial=true";

        await sendWhatsApp({
          phone: lead.phone,
          templateName: 'nudge_trial',
          body
        });

        results.nudged_new++;
      } catch (err) {
        console.error(`Nudge error for lead ${lead.id}:`, err.message);
        results.errors++;
      }
    }

    const { data: staleNewLeads } = await db
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('last_msg_at', twentyFourHoursAgo);

    for (const lead of (staleNewLeads || [])) {
      await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
    }

    const { data: reEngageLeads } = await db
      .from('leads')
      .select('id, phone, name, market, program_interest')
      .eq('status', 'dropped')
      .gt('created_at', sevenDaysAgo)
      .lt('created_at', fourteenDaysAgo);

    for (const lead of (reEngageLeads || [])) {
      try {
        const market = lead.market || detectMarket(lead.phone);
        const body = isHinglish(market)
          ? `Hey ${lead.name || ''}! Still interested in fitness goals? 💪 Maddy ke programs limited spots pe chal rahe hain. Koi bhi sawaal ho toh bata.\n\nhttps://fitnessbymaddy.com`
          : `Hey ${lead.name || ''}! Still thinking about your fitness goals? 💪 Maddy's programs have limited spots. Let us know if you have any questions.\n\nhttps://fitnessbymaddy.com`;

        await sendWhatsApp({
          phone: lead.phone,
          templateName: 'reengage_dropped',
          body
        });

        results.nudged_dropped++;
      } catch (err) {
        console.error(`Re-engage error for lead ${lead.id}:`, err.message);
        results.errors++;
      }
    }

    return res.status(200).json({ ok: true, results });
  } catch (err) {
    console.error('Nudge cron error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
