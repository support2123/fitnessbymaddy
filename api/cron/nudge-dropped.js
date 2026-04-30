const { supabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { isHinglish, detectMarket } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    // New leads with no reply after 2 hours — send nudge
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: staleNewLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', twoDaysAgo.toISOString());

    let nudged = 0;

    for (const lead of staleNewLeads || []) {
      const { data: msgs } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 'nudge_trial');

      if (msgs && msgs.length > 0) continue;

      const market = lead.market || detectMarket(lead.phone);
      const msg = isHinglish(market)
        ? "Abhi decide nahi hua? Koi baat nahi! Ek $20 trial session try karo — full coaching experience milega. Limited spots hai!\n\nhttps://fitnessbymaddy.com/shred.html"
        : "Still thinking? No worries! Try a $20 trial session for the full coaching experience. Limited spots available!\n\nhttps://fitnessbymaddy.com/shred.html";

      await sendWhatsApp(lead.phone, msg, 'nudge_trial');
      nudged++;
    }

    // Mark leads as dropped if no reply in 24 hours after nudge
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: nudgedLeads } = await supabase
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lt('created_at', oneDayAgo);

    let dropped = 0;

    for (const lead of nudgedLeads || []) {
      const { data: replies } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gt('sent_at', lead.created_at);

      if (!replies || replies.length <= 1) {
        await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    // Re-engage dropped leads (7-day rule — only once)
    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gt('last_msg_at', sevenDaysAgo.toISOString());

    let reengaged = 0;

    for (const lead of droppedLeads || []) {
      const { data: reengageMsgs } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 'reengage_7day');

      if (reengageMsgs && reengageMsgs.length > 0) continue;

      const daysSince = Math.floor((Date.now() - new Date(lead.last_msg_at).getTime()) / (1000 * 60 * 60 * 24));
      if (daysSince < 6 || daysSince > 8) continue;

      const market = lead.market || 'GLOBAL';
      const msg = isHinglish(market)
        ? "Hey! Maddy's team se ek last message. Agar abhi bhi fitness goals pe serious ho, toh reply karo — hum help karne ke liye ready hain!"
        : "Hey! One last message from Maddy's team. If you're still serious about your fitness goals, reply and we're ready to help!";

      await sendWhatsApp(lead.phone, msg, 'reengage_7day');
      reengaged++;
    }

    return res.json({ ok: true, nudged, dropped, reengaged });
  } catch (err) {
    console.error('Nudge cron error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
