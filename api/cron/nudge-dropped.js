const { supabase } = require('../lib/supabase');
const { sendWhatsApp, canSendMessage } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    if (process.env.NODE_ENV === 'production') {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

    // Find leads that went silent 2-7 days ago (nudge window)
    const { data: leads, error } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoDaysAgo)
      .gt('last_msg_at', sevenDaysAgo);

    if (error) throw error;

    let nudged = 0;

    for (const lead of leads || []) {
      if (!(await canSendMessage(lead.phone))) continue;

      await sendWhatsApp(lead.phone, 'nudge_trial', {
        name: lead.name || 'there',
        templateParams: [lead.name || 'there']
      });
      nudged++;
    }

    // Mark old leads (>7 days, no response) as dropped
    const { data: staleLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('last_msg_at', sevenDaysAgo);

    if (staleLeads && staleLeads.length > 0) {
      const ids = staleLeads.map(l => l.id);
      await supabase.from('leads')
        .update({ status: 'dropped' })
        .in('id', ids);
    }

    // Check for clients with 2+ missed check-ins
    const { data: activeClients } = await supabase
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    let escalated = 0;

    for (const client of activeClients || []) {
      const startDate = new Date(client.program_started_at);
      const currentWeek = Math.ceil((Date.now() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000));

      if (currentWeek < 3) continue;

      const { count } = await supabase
        .from('checkins')
        .select('id', { count: 'exact' })
        .eq('client_id', client.id);

      const missedWeeks = currentWeek - (count || 0);
      if (missedWeeks >= 2) {
        const { escalateToMaddy } = require('../lib/escalation');
        const { maskPhone } = require('../lib/whatsapp');
        await escalateToMaddy('2+ consecutive missed check-ins', {
          phone: maskPhone(client.phone),
          message: `${client.name} has missed ${missedWeeks} check-ins (week ${currentWeek})`
        });
        escalated++;
      }
    }

    return res.status(200).json({
      success: true,
      nudged,
      dropped: (staleLeads || []).length,
      escalated
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
