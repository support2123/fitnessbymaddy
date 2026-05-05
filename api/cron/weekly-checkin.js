const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  const supabase = getSupabase();

  // Get all active clients
  const { data: clients } = await supabase
    .from('clients')
    .select('*')
    .eq('status', 'active');

  if (!clients || clients.length === 0) {
    return res.status(200).json({ message: 'No active clients' });
  }

  const results = [];

  for (const client of clients) {
    // Calculate current week number
    const startDate = new Date(client.program_started_at);
    const now = new Date();
    const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

    // Check if program has ended
    if (client.program_ends_at && now > new Date(client.program_ends_at)) {
      continue;
    }

    // Check if already submitted this week
    const { data: existing } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .limit(1);

    if (existing && existing.length > 0) {
      continue;
    }

    const checkinLink = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

    // Detect market for language
    const market = client.phone?.startsWith('+91') || client.phone?.startsWith('91') ? 'IN' : 'GLOBAL';
    const msg = market === 'IN'
      ? `Week ${weekNo} ka check-in time! 📋\n\nApna progress share karo: ${checkinLink}\n\nPhotos + measurements dalna mat bhoolna 💪`
      : `Time for your Week ${weekNo} check-in! 📋\n\nShare your progress: ${checkinLink}\n\nDon't forget photos + measurements 💪`;

    await sendWhatsApp({
      phone: client.phone,
      templateName: 'weekly_checkin',
      params: [msg],
    });

    results.push({ client_id: client.id, week_no: weekNo });
  }

  return res.status(200).json({ sent: results.length, results });
};
