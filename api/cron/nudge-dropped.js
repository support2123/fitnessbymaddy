const { supabase } = require('../_lib/supabase');
const { sendText } = require('../_lib/whatsapp');
const { isHinglish, detectMarket, maskPhone } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString();

    const { data: staleLeads, error } = await supabase
      .from('leads')
      .select('*')
      .in('status', ['new', 'qualified'])
      .lt('last_msg_at', sevenDaysAgo)
      .gt('last_msg_at', fourteenDaysAgo);

    if (error) throw error;
    if (!staleLeads || staleLeads.length === 0) {
      return res.status(200).json({ message: 'No leads to nudge', nudged: 0 });
    }

    let nudged = 0;

    for (const lead of staleLeads) {
      try {
        const hinglish = isHinglish(lead.market || detectMarket(lead.phone));

        const msg = hinglish
          ? `Hey ${lead.name || 'there'}! Maddy's team se. Abhi bhi fitness goals ke baare mein soch rahe ho? Humare $20 trial session se start karo — koi commitment nahi:\nhttps://fitnessbymaddy.com/intake?lead=${lead.id}\n\nReply STOP to unsubscribe.`
          : `Hey ${lead.name || 'there'}! Still thinking about your fitness goals? Start with our $20 trial session — no commitment:\nhttps://fitnessbymaddy.com/intake?lead=${lead.id}\n\nReply STOP to unsubscribe.`;

        const result = await sendText(lead.phone, msg);

        if (result.ok) {
          await supabase
            .from('leads')
            .update({ last_msg_at: new Date().toISOString() })
            .eq('id', lead.id);
          nudged++;
        }
      } catch (leadErr) {
        console.error(`Nudge failed for ${maskPhone(lead.phone)}:`, leadErr.message);
      }
    }

    return res.status(200).json({
      message: `Nudged ${nudged} leads`,
      nudged,
      total: staleLeads.length
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
