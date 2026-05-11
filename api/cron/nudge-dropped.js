import supabase from '../../lib/supabase.js';
import { sendTemplate, sendText } from '../../lib/whatsapp.js';
import { isHinglishMarket, detectMarket, maskPhone } from '../../lib/market.js';

const NUDGE_WINDOW_DAYS = 7;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - NUDGE_WINDOW_DAYS);

    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    // Find leads that went silent 2-7 days ago (status = new, not dropped)
    const { data: stalledLeads, error } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoDaysAgo.toISOString())
      .gt('last_msg_at', sevenDaysAgo.toISOString());

    if (error) {
      console.error('Nudge query error:', error);
      return res.status(500).json({ error: 'Database error' });
    }

    let nudged = 0;
    let dropped = 0;

    for (const lead of stalledLeads || []) {
      const lastMsg = new Date(lead.last_msg_at);
      const hoursSilent = (Date.now() - lastMsg.getTime()) / (1000 * 60 * 60);

      // 2-hour nudge already handled by webhook flow
      // This cron handles the 24-48 hour nudge window
      if (hoursSilent >= 24 && hoursSilent < 48) {
        const market = detectMarket(lead.phone);
        const hinglish = isHinglishMarket(market);

        const msg = hinglish
          ? `Hey! Maddy ka $20 trial try karna hai? Ek Zoom session mein dekh lo ki coaching kaise work karti hai 💪\n\nhttps://www.fitnessbymaddy.com/program-trial.html`
          : `Hey! Want to try Maddy's $20 trial? One Zoom session to see how the coaching works 💪\n\nhttps://www.fitnessbymaddy.com/program-trial.html`;

        await sendText(lead.phone, msg);
        nudged++;
        console.log(`Nudged: ${maskPhone(lead.phone)}`);
      }
    }

    // Drop leads beyond 7-day window
    const { data: expiredLeads } = await supabase
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lt('last_msg_at', sevenDaysAgo.toISOString());

    for (const lead of expiredLeads || []) {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('id', lead.id);
      dropped++;
      console.log(`Dropped: ${maskPhone(lead.phone)}`);
    }

    // Also nudge qualified leads who haven't paid (3-day window)
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    const { data: qualifiedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'qualified')
      .lt('last_msg_at', twoDaysAgo.toISOString())
      .gt('last_msg_at', threeDaysAgo.toISOString());

    let qualifiedNudged = 0;
    for (const lead of qualifiedLeads || []) {
      const market = detectMarket(lead.phone);
      const hinglish = isHinglishMarket(market);

      const msg = hinglish
        ? `Reminder: Tumhara program select ho gaya hai par payment pending hai. Koi doubt hai? Reply karo, hum help karenge! 🙌`
        : `Just a reminder — your program is selected but payment is pending. Any questions? Reply and we'll help! 🙌`;

      await sendText(lead.phone, msg);
      qualifiedNudged++;
    }

    return res.status(200).json({ nudged, dropped, qualifiedNudged });
  } catch (err) {
    console.error('Nudge cron error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
