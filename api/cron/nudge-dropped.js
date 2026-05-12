const { supabase } = require('../_lib/supabase');
const { sendWhatsApp, detectMarket } = require('../_lib/whatsapp');
const { escalateToMaddy, maskPhone } = require('../_lib/escalation');

module.exports = async function handler(req, res) {
  try {
    const now = new Date();

    // Nudge leads with no reply after 2 hours (still status=new)
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const { data: staleNewLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo);

    let nudged = 0;
    if (staleNewLeads) {
      for (const lead of staleNewLeads) {
        const hoursSinceCreated = (now - new Date(lead.created_at)) / (1000 * 60 * 60);

        if (hoursSinceCreated >= 24) {
          await supabase
            .from('leads')
            .update({ status: 'dropped' })
            .eq('id', lead.id);
          continue;
        }

        if (hoursSinceCreated >= 2 && hoursSinceCreated < 24) {
          const market = detectMarket(lead.phone);
          const msg = market === 'IN'
            ? ['Hey! Maddy ka $20 trial try karo - full Zoom session, personalized guidance. Limited spots!']
            : ['Hey! Try Maddy\'s $20 trial - full Zoom session with personalized guidance. Limited spots!'];

          await sendWhatsApp(lead.phone, 'nudge_trial', {
            name: lead.name || 'there',
            templateParams: msg
          });
          nudged++;
        }
      }
    }

    // Check for clients with 2+ consecutive missed check-ins
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let escalations = 0;
    if (activeClients) {
      for (const client of activeClients) {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSinceStart / 7);

        if (currentWeek < 3) continue;

        const { data: recentCheckins } = await supabase
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(2);

        const submitted = recentCheckins ? recentCheckins.map(c => c.week_no) : [];
        const missedConsecutive =
          !submitted.includes(currentWeek - 1) &&
          !submitted.includes(currentWeek - 2);

        if (missedConsecutive) {
          await escalateToMaddy(
            '2 consecutive missed check-ins',
            `Client: ${client.name} (${maskPhone(client.phone)}) - Weeks ${currentWeek - 2} & ${currentWeek - 1}`
          );
          escalations++;
        }
      }
    }

    // Re-engage dropped leads (7-day re-engagement)
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString();
    const { data: reengageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', eightDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    let reengaged = 0;
    if (reengageLeads) {
      for (const lead of reengageLeads) {
        const market = detectMarket(lead.phone);
        await sendWhatsApp(lead.phone, 'reengage_7day', {
          name: lead.name || 'there',
          templateParams: [
            lead.name || 'there',
            market === 'IN'
              ? 'Abhi bhi interested ho? Maddy ke programs dekhlo - results guaranteed!'
              : 'Still interested? Check out Maddy\'s programs - real results guaranteed!'
          ]
        });
        reengaged++;
      }
    }

    return res.status(200).json({ ok: true, nudged, escalations, reengaged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
