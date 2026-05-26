const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const authHeader = req.headers['authorization'];
  const isAuthed = authHeader === `Bearer ${process.env.SUPABASE_SERVICE_KEY}`;

  if (!isVercelCron && !isAuthed) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();

    // Nudge new leads with no reply after 2 hours
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const { data: staleNewLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', new Date(now - 24 * 60 * 60 * 1000).toISOString());

    let nudged = 0;

    if (staleNewLeads) {
      for (const lead of staleNewLeads) {
        const { data: outMessages } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'nudge_trial')
          .limit(1);

        if (outMessages && outMessages.length > 0) continue;

        const trialUrl = 'https://www.fitnessbymaddy.com/shred.html';
        const params = lead.market === 'IN'
          ? [lead.name || 'there', 'Sirf $20 mein Maddy ke saath trial session le lo!', trialUrl]
          : [lead.name || 'there', 'Try a trial session with Maddy for just $20!', trialUrl];

        await sendTemplate(lead.phone, 'nudge_trial', params);
        nudged++;
      }
    }

    // Mark leads as dropped after 24 hours of no reply
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const { data: expiredLeads } = await supabase
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lt('created_at', oneDayAgo);

    let dropped = 0;

    if (expiredLeads) {
      for (const lead of expiredLeads) {
        const { data: replies } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .gt('sent_at', lead.created_at)
          .limit(1);

        if (replies && replies.length > 0) continue;

        await supabase
          .from('leads')
          .update({ status: 'dropped' })
          .eq('id', lead.id);
        dropped++;
      }
    }

    // Re-engage dropped leads (7-day cool-off)
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data: reEngageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo)
      .gt('last_msg_at', fourteenDaysAgo);

    let reEngaged = 0;

    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        const { data: reEngageMessages } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'reengage_offer')
          .limit(1);

        if (reEngageMessages && reEngageMessages.length > 0) continue;

        const params = lead.market === 'IN'
          ? [lead.name || 'there', 'Abhi bhi interested ho? Special offer sirf tere liye!']
          : [lead.name || 'there', 'Still interested? We have a special offer just for you!'];

        await sendTemplate(lead.phone, 'reengage_offer', params);
        reEngaged++;
      }
    }

    return res.status(200).json({
      ok: true,
      nudged,
      dropped,
      re_engaged: reEngaged
    });
  } catch (error) {
    console.error('Nudge cron error:', error.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
