const { supabase } = require('../../lib/supabase');
const { sendWhatsApp, canSendMessage } = require('../../lib/whatsapp');
const { maskPhone, jsonResponse } = require('../../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse(res, { error: 'Method not allowed' }, 405);
  }

  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return jsonResponse(res, { error: 'Unauthorized' }, 401);
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: staleLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('last_msg_at', sevenDaysAgo)
      .gte('last_msg_at', fourteenDaysAgo);

    if (!staleLeads || staleLeads.length === 0) {
      return jsonResponse(res, { action: 'no_stale_leads' });
    }

    const results = [];

    for (const lead of staleLeads) {
      const allowed = await canSendMessage(lead.phone);
      if (!allowed) {
        results.push({ phone: maskPhone(lead.phone), action: 'rate_limited' });
        continue;
      }

      const { data: outboundCount } = await supabase
        .from('messages')
        .select('id', { count: 'exact' })
        .eq('phone', lead.phone)
        .eq('direction', 'out');

      if (outboundCount && outboundCount.length >= 4) {
        await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        results.push({ phone: maskPhone(lead.phone), action: 'dropped_max_nudges' });
        continue;
      }

      const market = lead.market || 'GLOBAL';
      const params = market === 'IN'
        ? ['Hey! Maddy ki team se. Abhi bhi interested ho? Humara $20 trial try karo — koi commitment nahi: https://fitnessbymaddy.com/shred.html']
        : ['Hey! Still interested in getting started? Try our $20 trial session — no commitment: https://fitnessbymaddy.com/shred.html'];

      await sendWhatsApp(lead.phone, 'nudge_trial', params);
      results.push({ phone: maskPhone(lead.phone), action: 'nudged' });
      console.log(`Nudge sent: ${maskPhone(lead.phone)}`);
    }

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: noReplyLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo)
      .gte('created_at', sevenDaysAgo);

    if (noReplyLeads) {
      for (const lead of noReplyLeads) {
        const { data: replies } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .gt('sent_at', lead.created_at)
          .limit(1);

        if (replies && replies.length > 0) continue;

        const { data: nudges } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'nudge_trial')
          .limit(1);

        if (nudges && nudges.length > 0) continue;

        const allowed = await canSendMessage(lead.phone);
        if (!allowed) continue;

        const market = lead.market || 'GLOBAL';
        const params = market === 'IN'
          ? ['Hey! Humne notice kiya ki tune reply nahi kiya. Koi baat nahi — jab ready ho, $20 trial se start karo!']
          : ['Hey! We noticed you haven\'t replied yet. No worries — start with our $20 trial when you\'re ready!'];

        await sendWhatsApp(lead.phone, 'nudge_trial', params);
        results.push({ phone: maskPhone(lead.phone), action: '2hr_nudge' });
      }
    }

    return jsonResponse(res, { success: true, processed: results.length, results });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return jsonResponse(res, { error: 'Internal error' }, 500);
  }
};
