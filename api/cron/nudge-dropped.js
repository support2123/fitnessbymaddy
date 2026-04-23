const { supabase } = require('../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');
const { json } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return json(res, 401, { error: 'Unauthorized' });
  }

  try {
    const now = new Date();

    // --- PART 1: Nudge leads who haven't replied ---

    // 2-hour nudge: new leads with no reply
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const fourHoursAgo = new Date(now - 4 * 60 * 60 * 1000).toISOString();

    const { data: needsNudge } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', fourHoursAgo);

    let nudged = 0;
    for (const lead of (needsNudge || [])) {
      const { data: replies } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gt('sent_at', lead.created_at)
        .limit(1);

      if (!replies || replies.length === 0) {
        await sendTemplate(lead.phone, 'nudge_trial', [
          lead.name || 'there',
          'https://fitnessbymaddy.com/intake?lead=' + lead.id
        ]);
        nudged++;
      }
    }

    // 24-hour drop: leads still with no reply
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

    const { data: staleLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', oneDayAgo);

    let dropped = 0;
    for (const lead of (staleLeads || [])) {
      const { data: replies } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gt('sent_at', lead.created_at)
        .limit(1);

      if (!replies || replies.length === 0) {
        await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    // --- PART 2: Check-in nudges for active clients ---

    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let checkinNudges = 0;
    let missedEscalations = 0;

    for (const client of (activeClients || [])) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) continue;

      const { data: checkin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (checkin) continue;

      const sundayDaysSinceStart = (weekNo - 1) * 7;
      const checkinDueDate = new Date(startDate);
      checkinDueDate.setDate(checkinDueDate.getDate() + sundayDaysSinceStart + 7);

      const daysSinceDue = Math.floor((now - checkinDueDate) / (1000 * 60 * 60 * 24));

      if (daysSinceDue >= 1 && daysSinceDue <= 2) {
        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
        await sendTemplate(client.phone, 'checkin_reminder', [
          client.name || 'there',
          checkinUrl
        ]);
        checkinNudges++;
      }

      // 2 consecutive missed check-ins → escalate
      if (weekNo >= 2) {
        const { data: prevCheckin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo - 1)
          .single();

        if (!prevCheckin && daysSinceDue > 2) {
          await notifyMaddy(
            '2 consecutive missed check-ins',
            `Client: ${client.name || client.phone}\nProgram: ${client.program}\nMissed weeks: ${weekNo - 1} and ${weekNo}`
          );
          missedEscalations++;
        }
      }
    }

    return json(res, 200, {
      nudged,
      dropped,
      checkin_nudges: checkinNudges,
      missed_escalations: missedEscalations
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return json(res, 500, { error: 'Internal server error' });
  }
};
