const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: staleNewLeads } = await supabase
      .from('leads')
      .select('id, phone, name, market, created_at')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo)
      .gte('created_at', twentyFourHoursAgo);

    let nudged = 0;

    if (staleNewLeads) {
      for (const lead of staleNewLeads) {
        const { data: msgs } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'nudge_trial')
          .limit(1);

        if (msgs && msgs.length > 0) continue;

        await sendWhatsApp(lead.phone, 'nudge_trial', [
          lead.name || 'there',
          'https://fitnessbymaddy.com/program-trial.html'
        ]);
        nudged++;
      }
    }

    const { data: deadLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lte('created_at', twentyFourHoursAgo);

    let dropped = 0;
    if (deadLeads) {
      for (const lead of deadLeads) {
        await supabase.from('leads')
          .update({ status: 'dropped' })
          .eq('id', lead.id);
        dropped++;
      }
    }

    const { data: missedCheckins } = await supabase
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    let escalations = 0;
    if (missedCheckins) {
      for (const client of missedCheckins) {
        const startDate = new Date(client.program_started_at);
        const weekNo = Math.ceil((Date.now() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000));

        const { data: recentCheckins } = await supabase
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .gte('week_no', weekNo - 2)
          .order('week_no', { ascending: false });

        const missedWeeks = [];
        for (let w = weekNo; w >= Math.max(1, weekNo - 1); w--) {
          if (!recentCheckins || !recentCheckins.find(c => c.week_no === w)) {
            missedWeeks.push(w);
          }
        }

        if (missedWeeks.length >= 2) {
          await escalateToMaddy('2 consecutive missed check-ins', {
            clientName: client.name,
            phone: client.phone,
            details: `Missed weeks: ${missedWeeks.join(', ')}`
          });
          escalations++;
        }
      }
    }

    return res.status(200).json({ success: true, nudged, dropped, escalations });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
