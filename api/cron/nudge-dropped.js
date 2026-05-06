const { supabase } = require('../_lib/supabase');
const { sendText, canSendToLead, maskPhone } = require('../_lib/whatsapp');
const { detectMarket } = require('../_lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    if (!req.headers['x-vercel-cron']) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: leads, error } = await supabase
      .from('leads')
      .select('id, phone, name, market, program_interest')
      .eq('status', 'dropped')
      .gte('created_at', fourteenDaysAgo)
      .lte('created_at', sevenDaysAgo);

    if (error) {
      console.error('Fetch dropped leads error:', error.message);
      return res.status(500).json({ error: 'Failed to fetch leads' });
    }

    let sent = 0;
    let skipped = 0;

    for (const lead of leads || []) {
      const allowed = await canSendToLead(lead.phone);
      if (!allowed) {
        skipped++;
        continue;
      }

      const { count } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .gte('sent_at', sevenDaysAgo);

      if (count > 0) {
        skipped++;
        continue;
      }

      const market = lead.market || detectMarket(lead.phone);
      const isHinglish = market === 'IN';

      const msg = isHinglish
        ? `Hey ${lead.name || 'there'}! 👋 Maddy ki team se — abhi bhi fitness goals ke baare mein soch rahe ho? Hamara $20 trial session perfect start hai.\n\nBook karo: https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial\n\nReply STOP to opt out.`
        : `Hey ${lead.name || 'there'}! 👋 From Maddy's team — still thinking about your fitness goals? Our $20 trial session is the perfect way to start.\n\nBook here: https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial\n\nReply STOP to opt out.`;

      await sendText(lead.phone, msg);
      sent++;
      console.log(`Nudge sent: ${maskPhone(lead.phone)}`);
    }

    return res.status(200).json({ ok: true, sent, skipped, total: (leads || []).length });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
