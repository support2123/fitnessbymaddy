const { getSupabase } = require('../lib/supabase');
const { sendTemplate, canSendToLead } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();

  const { data: activeClients, error } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active')
    .lte('program_started_at', new Date().toISOString());

  if (error) {
    return res.status(500).json({ error: 'Failed to fetch clients' });
  }

  const results = { sent: 0, skipped: 0, errors: 0 };

  for (const client of activeClients || []) {
    const startDate = new Date(client.program_started_at);
    const now = new Date();
    const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
    const currentWeek = Math.floor(daysSinceStart / 7) + 1;

    const programWeeks = {
      '6wk_gym': 6, '6wk_home': 6, '12wk': 12,
      'pcos': 8, '40plus': 8, 'zoom_trial': 1, 'zoom_pack': 4
    };

    const maxWeeks = programWeeks[client.program] || 12;
    if (currentWeek > maxWeeks) {
      await db.from('clients').update({ status: 'completed' }).eq('id', client.id);
      results.skipped++;
      continue;
    }

    const { data: existing } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', currentWeek)
      .single();

    if (existing) {
      results.skipped++;
      continue;
    }

    try {
      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;
      await sendTemplate(client.phone, 'weekly_checkin', [
        client.name || 'there',
        `${currentWeek}`,
        checkinUrl
      ]);
      results.sent++;
    } catch (e) {
      console.error(`Check-in send failed for client ${client.id}:`, e.message);
      results.errors++;
    }
  }

  res.status(200).json({ success: true, ...results, total: activeClients?.length || 0 });
};
