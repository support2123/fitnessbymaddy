const { getSupabase } = require('../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabase = getSupabase();

  const { data: clients } = await supabase
    .from('clients')
    .select('*')
    .eq('status', 'active');

  if (!clients || clients.length === 0) {
    return res.status(200).json({ action: 'no_active_clients' });
  }

  const results = [];

  for (const client of clients) {
    const startDate = new Date(client.program_started_at);
    const now = new Date();
    const diffMs = now - startDate;
    const weekNo = Math.ceil(diffMs / (7 * 24 * 60 * 60 * 1000));

    const maxWeeks = client.program === '12wk' ? 12 : 6;
    if (weekNo > maxWeeks) {
      await supabase
        .from('clients')
        .update({ status: 'completed' })
        .eq('id', client.id);
      results.push({ client_id: client.id, action: 'completed' });
      continue;
    }

    const { data: existing } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .single();

    if (existing) {
      results.push({ client_id: client.id, action: 'already_submitted' });
      continue;
    }

    const checkinLink = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
    await sendTemplate(client.phone, 'weekly_checkin', {
      name: client.name,
      templateParams: [client.name, String(weekNo), checkinLink]
    });

    const { data: missedCount } = await supabase
      .from('checkins')
      .select('id', { count: 'exact' })
      .eq('client_id', client.id)
      .gte('week_no', weekNo - 2);

    const submittedWeeks = missedCount ? missedCount.length : 0;
    const expectedWeeks = Math.min(2, weekNo - 1);

    if (expectedWeeks > 0 && submittedWeeks === 0) {
      await notifyMaddy(`Client ${client.name} missed 2 consecutive check-ins (Week ${weekNo}). Manual follow-up needed.`);
    }

    results.push({ client_id: client.id, action: 'checkin_sent', week_no: weekNo });
  }

  return res.status(200).json({ processed: results.length, results });
};
