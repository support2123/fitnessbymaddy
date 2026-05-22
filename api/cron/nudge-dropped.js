const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, isHinglish, detectMarket } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeadsNoReply } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
      .gt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    let nudgesSent = 0;

    if (newLeadsNoReply) {
      for (const lead of newLeadsNoReply) {
        const market = detectMarket(lead.phone);
        const hinglish = isHinglish(market);

        const msg = hinglish
          ? `Hey! 👋 Ek quick question — kya tujhe $20 trial class try karni hai pehle? Bilkul risk-free hai.\n\nhttps://fitnessbymaddy.com/shred.html\n\nBas reply kar "trial" aur done! 💪`
          : `Hey! 👋 Quick question — would you like to try a $20 trial class first? Completely risk-free.\n\nhttps://fitnessbymaddy.com/shred.html\n\nJust reply "trial" and we'll set you up! 💪`;

        await sendWhatsApp({
          phone: lead.phone,
          templateName: 'nudge_trial',
          body: msg,
          params: [lead.name || 'there']
        });
        nudgesSent++;
      }
    }

    const { data: staleNewLeads } = await db
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('last_msg_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    let dropped = 0;
    if (staleNewLeads) {
      for (const lead of staleNewLeads) {
        await db.from('leads')
          .update({ status: 'dropped' })
          .eq('id', lead.id);
        dropped++;
      }
    }

    const { data: reEngageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gt('created_at', fourteenDaysAgo)
      .lt('created_at', sevenDaysAgo);

    let reEngaged = 0;

    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        const { data: msgCount } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .gt('sent_at', sevenDaysAgo);

        if (msgCount && msgCount.length > 0) continue;

        const market = detectMarket(lead.phone);
        const hinglish = isHinglish(market);

        const msg = hinglish
          ? `Hi ${lead.name || 'there'}! Maddy yahan se 🙋‍♀️ Abhi bhi fitness goals pe kaam karna hai? Hum teri help karne ke liye ready hain. Reply kar aur shuru karte hain! 💪`
          : `Hi ${lead.name || 'there'}! Maddy here 🙋‍♀️ Still working on those fitness goals? We're ready to help whenever you are. Reply and let's get started! 💪`;

        await sendWhatsApp({ phone: lead.phone, body: msg });
        reEngaged++;
      }
    }

    return res.status(200).json({
      nudgesSent,
      dropped,
      reEngaged
    });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
