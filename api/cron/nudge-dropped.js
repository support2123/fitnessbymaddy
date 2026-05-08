const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { detectMarket, isHinglish } = require('../../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', fourteenDaysAgo.toISOString())
      .lte('last_msg_at', sevenDaysAgo.toISOString());

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ action: 'no_leads_to_nudge' });
    }

    const { data: alreadyNudged } = await db
      .from('messages')
      .select('phone')
      .eq('template_name', 'reengagement')
      .gte('sent_at', sevenDaysAgo.toISOString());

    const nudgedPhones = new Set((alreadyNudged || []).map(m => m.phone));

    let sent = 0;
    for (const lead of droppedLeads) {
      if (nudgedPhones.has(lead.phone)) continue;

      const market = detectMarket(lead.phone);
      const template = isHinglish(market) ? 'reengagement_hi' : 'reengagement_en';

      await sendWhatsApp(lead.phone, template, [lead.name || 'there']);
      sent++;

      if (sent >= 50) break;
    }

    return res.status(200).json({ processed: droppedLeads.length, sent });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
