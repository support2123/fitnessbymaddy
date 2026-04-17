const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { maskPhone } = require('../_lib/market');
const { isHinglish } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cronSecret = req.headers['x-vercel-cron'];
  const authHeader = req.headers['authorization'];
  if (!cronSecret && (!authHeader || authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabase = getSupabase();

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .eq('opted_out', false)
      .gte('created_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ message: 'No leads to nudge', sent: 0 });
    }

    let sent = 0;

    for (const lead of droppedLeads) {
      const { data: recentMsg } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .gte('sent_at', sevenDaysAgo)
        .limit(1);

      if (recentMsg && recentMsg.length > 0) continue;

      const hinglish = isHinglish(lead.market);
      const body = hinglish
        ? `Hey ${lead.name || 'there'}! Abhi bhi decide nahi kiya? \u{1F914}\n\nMaddy ka $20 trial try karo — ek Zoom session mein samajh aa jayega ki ye tumhare liye sahi hai ya nahi.\n\nBook karo: https://fitnessbymaddy.com/program-trial.html\n\nKoi commitment nahi, sirf 1 session \u{1F4AA}`
        : `Hey ${lead.name || 'there'}! Still thinking? \u{1F914}\n\nTry Maddy's $20 trial — one Zoom session to see if it's the right fit for you.\n\nBook here: https://fitnessbymaddy.com/program-trial.html\n\nNo commitment, just 1 session \u{1F4AA}`;

      const result = await sendWhatsApp({
        phone: lead.phone,
        templateName: 'nudge_trial',
        body,
        params: { name: lead.name || 'there' },
      });

      if (result.sent) {
        sent++;
        console.log(`Nudge sent: ${maskPhone(lead.phone)}`);
      }
    }

    return res.status(200).json({ sent, total: droppedLeads.length });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
