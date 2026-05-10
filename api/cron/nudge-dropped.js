const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeadsToNudge } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
      .gt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    let nudged = 0;

    for (const lead of (newLeadsToNudge || [])) {
      const hinglish = isHinglish(detectMarket(lead.phone));
      const msg = hinglish
        ? `Hey! 👋 Maddy ka $20 trial try karna chahoge? Ek Zoom session mein hi samajh aa jayega.\n\n👉 https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial`
        : `Hey! 👋 Want to try Maddy's $20 trial session? One Zoom call and you'll see the difference.\n\n👉 https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial`;

      await sendWhatsApp(lead.phone, { template: 'nudge_trial', params: [lead.name || 'there'] });
      nudged++;
    }

    const { data: staleNewLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('last_msg_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    if (staleNewLeads && staleNewLeads.length > 0) {
      const ids = staleNewLeads.map(l => l.id);
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .in('id', ids);
    }

    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    for (const client of (activeClients || [])) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      const { data: recentCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      const completedWeeks = (recentCheckins || []).map(c => c.week_no);
      const missedConsecutive = currentWeek >= 2
        && !completedWeeks.includes(currentWeek)
        && !completedWeeks.includes(currentWeek - 1);

      if (missedConsecutive) {
        await escalateToMaddy('2 consecutive missed check-ins', {
          clientName: client.name,
          clientId: client.id,
          currentWeek,
          lastCheckins: completedWeeks
        });
      }
    }

    return res.json({
      ok: true,
      nudged,
      dropped: staleNewLeads?.length || 0
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
