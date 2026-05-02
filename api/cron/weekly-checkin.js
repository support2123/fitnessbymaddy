const supabase = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');
const { detectMarket, isHinglish } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();

    // --- 1. Mark expired programs as completed ---
    const { data: expiredClients, error: expiredError } = await supabase
      .from('clients')
      .select('id, phone, name')
      .eq('status', 'active')
      .lt('program_ends_at', now.toISOString());

    if (expiredError) {
      console.error('Error fetching expired clients:', expiredError.message);
    }

    let completedCount = 0;
    if (expiredClients && expiredClients.length > 0) {
      const expiredIds = expiredClients.map((c) => c.id);
      const { error: updateError } = await supabase
        .from('clients')
        .update({ status: 'completed' })
        .in('id', expiredIds);

      if (updateError) {
        console.error('Error updating expired clients:', updateError.message);
      } else {
        completedCount = expiredIds.length;
        console.log(`Marked ${completedCount} client(s) as completed`);
      }
    }

    // --- 2. Send weekly check-in messages ---
    const { data: activeClients, error: clientsError } = await supabase
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    if (clientsError) {
      console.error('Error fetching active clients:', clientsError.message);
      return res.status(500).json({ error: 'Failed to fetch active clients' });
    }

    let processed = 0;
    let sentCount = 0;

    for (const client of activeClients || []) {
      processed++;

      // Calculate current week number
      const startDate = new Date(client.program_started_at);
      const diffMs = now.getTime() - startDate.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      const weekNo = Math.floor(diffDays / 7) + 1;

      if (weekNo < 1) continue;

      // Check if checkin already exists for this week
      const { data: existingCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .maybeSingle();

      if (existingCheckin) {
        console.log(`Checkin already exists for client ${client.id} week ${weekNo}`);
        continue;
      }

      // Determine language based on phone market
      const market = detectMarket(client.phone);
      const hinglish = isHinglish(market);

      const checkinLink = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

      const templateParams = hinglish
        ? [client.name, String(weekNo), checkinLink]
        : [client.name, String(weekNo), checkinLink];

      const templateName = hinglish ? 'weekly_checkin_hi' : 'weekly_checkin';

      const { success } = await sendTemplate(client.phone, templateName, templateParams);
      if (success) {
        sentCount++;
        console.log(`Sent check-in to ${client.name} for week ${weekNo}`);
      }
    }

    return res.status(200).json({
      processed,
      sent: sentCount,
      completed: completedCount,
    });
  } catch (err) {
    console.error('weekly-checkin cron error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
