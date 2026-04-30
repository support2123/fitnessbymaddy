const { supabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { maskPhone } = require('../_lib/pii');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', sevenDaysAgo);

    let nudged = 0;

    if (newLeads) {
      for (const lead of newLeads) {
        const { data: recentMsg } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .gte('sent_at', twoHoursAgo)
          .limit(1);

        if (recentMsg && recentMsg.length > 0) continue;

        const hoursSinceCreation = (Date.now() - new Date(lead.created_at).getTime()) / (1000 * 60 * 60);
        const isHinglish = (lead.market || 'GLOBAL') === 'IN';

        if (hoursSinceCreation < 24) {
          const msg = isHinglish
            ? `Hey! Maddy ka $20 trial session try karna chahoge? Ek Zoom session mein pata chalega ki kaise results milenge.\n\nBook here: https://www.fitnessbymaddy.com/intake?lead=${lead.id}&program=trial`
            : `Hey! Want to try Maddy's $20 trial session? One Zoom session to see how real coaching works.\n\nBook here: https://www.fitnessbymaddy.com/intake?lead=${lead.id}&program=trial`;

          await sendWhatsApp(lead.phone, msg, 'nudge_trial');
          nudged++;
        } else {
          await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        }
      }
    }

    const droppedCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const reengageCutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', droppedCutoff)
      .gt('last_msg_at', reengageCutoff)
      .limit(20);

    let reengaged = 0;

    if (droppedLeads) {
      for (const lead of droppedLeads) {
        const isHinglish = (lead.market || 'GLOBAL') === 'IN';
        const msg = isHinglish
          ? `Hey ${lead.name || ''}! Maddy ki team se. Abhi bhi fitness goals pe kaam karna hai? Sirf $20 mein trial session available hai — limited time.\n\nBook: https://www.fitnessbymaddy.com/intake?lead=${lead.id}&program=trial`
          : `Hey ${lead.name || ''}! Maddy's team here. Still working on those fitness goals? Our $20 trial session is available for a limited time.\n\nBook: https://www.fitnessbymaddy.com/intake?lead=${lead.id}&program=trial`;

        await sendWhatsApp(lead.phone, msg);
        reengaged++;
      }
    }

    console.log(`Nudge cron: nudged=${nudged}, reengaged=${reengaged}`);
    return res.status(200).json({ nudged, reengaged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
