const { supabase } = require('../lib/supabase');
const { sendTemplate, sendTextMessage, canSendMessage, escalateToMaddy } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !process.env.VERCEL_URL) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // FLOW A nudge: new leads with no reply in 2hrs but less than 24hrs
    const { data: nudgeLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo.toISOString())
      .gt('last_msg_at', twentyFourHoursAgo.toISOString());

    let nudged = 0;
    if (nudgeLeads) {
      for (const lead of nudgeLeads) {
        if (await canSendMessage(lead.phone)) {
          await sendTemplate(lead.phone, 'nudge_trial', [lead.name || 'there']);
          nudged++;
        }
      }
    }

    // Drop leads older than 24hrs with no engagement
    const { data: dropLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('last_msg_at', twentyFourHoursAgo.toISOString());

    let dropped = 0;
    if (dropLeads) {
      const dropIds = dropLeads.map(l => l.id);
      if (dropIds.length > 0) {
        await supabase.from('leads').update({ status: 'dropped' }).in('id', dropIds);
        dropped = dropIds.length;
      }
    }

    // Check for clients with 2 consecutive missed check-ins
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let escalated = 0;
    if (activeClients) {
      for (const client of activeClients) {
        const startDate = new Date(client.program_started_at);
        const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

        if (weekNo < 3) continue;

        const { data: recentCheckins } = await supabase
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(2);

        const lastTwoWeeks = [weekNo - 1, weekNo - 2];
        const submittedWeeks = (recentCheckins || []).map(c => c.week_no);
        const missedBoth = lastTwoWeeks.every(w => !submittedWeeks.includes(w));

        if (missedBoth) {
          await escalateToMaddy(client.phone, '2 consecutive missed check-ins', `${client.name} missed weeks ${weekNo - 2} and ${weekNo - 1}`);
          escalated++;
        }
      }
    }

    return res.status(200).json({ success: true, nudged, dropped, escalated });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
