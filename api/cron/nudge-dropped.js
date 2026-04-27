const { getSupabase } = require('../_lib/supabase');
const { sendRateLimited } = require('../_lib/whatsapp');
const { detectMarket } = require('../_lib/phone');

const REENGAGEMENT_WINDOW_DAYS = 7;

module.exports = async function handler(req, res) {
  try {
    const supabase = getSupabase();
    const now = new Date();
    const windowStart = new Date(now.getTime() - REENGAGEMENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('created_at', windowStart.toISOString())
      .order('created_at', { ascending: false });

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ message: 'No leads to re-engage', processed: 0 });
    }

    const { data: recentMessages } = await supabase
      .from('messages')
      .select('phone, sent_at')
      .eq('direction', 'out')
      .in('phone', droppedLeads.map(l => l.phone))
      .gte('sent_at', new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString());

    const recentlyMessaged = new Set((recentMessages || []).map(m => m.phone));

    let sent = 0;

    for (const lead of droppedLeads) {
      if (recentlyMessaged.has(lead.phone)) continue;

      const market = lead.market || detectMarket(lead.phone);
      const isIN = market === 'IN';

      const params = isIN
        ? ['Hey! Maddy ke programs mein abhi bhi interest hai? $20 ka trial session try karo — no commitment: https://fitnessbymaddy.com/intake']
        : ['Hey! Still interested in working with Maddy? Try a $20 trial session — no commitment: https://fitnessbymaddy.com/intake'];

      const result = await sendRateLimited(lead.phone, 'nudge_trial', params);
      if (!result?.skipped) sent++;
    }

    return res.status(200).json({
      success: true,
      eligible: droppedLeads.length,
      sent
    });
  } catch (err) {
    console.error('Nudge dropped cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
