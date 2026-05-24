const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { isHinglish, maskPhone } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;
  if (!isCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*, leads(*)')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sentCount = 0;
    const errors = [];

    for (const client of activeClients) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSinceStart / 7);

        if (currentWeek < 1) continue;

        const endDate = new Date(client.program_ends_at);
        if (now > endDate) {
          await supabase
            .from('clients')
            .update({ status: 'completed' })
            .eq('id', client.id);
          continue;
        }

        const { data: existingCheckin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .single();

        if (existingCheckin) continue;

        const { data: prevCheckins } = await supabase
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(2);

        const missedConsecutive = prevCheckins
          ? (currentWeek - 1) - (prevCheckins[0]?.week_no || 0) >= 2
          : false;

        if (missedConsecutive) {
          await supabase.from('escalations').insert({
            phone: client.phone,
            trigger_keyword: 'consecutive_missed_checkins',
            message_body: `Client ${maskPhone(client.phone)} missed 2+ consecutive check-ins`
          });
        }

        const checkinLink = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;
        const market = client.leads?.market || 'GLOBAL';
        const hinglish = isHinglish(market);

        const templateName = hinglish ? 'weekly_checkin' : 'weekly_checkin_en';
        await sendTemplate(client.phone, templateName, [
          client.name || 'there',
          String(currentWeek),
          checkinLink
        ]);

        sentCount++;

      } catch (clientErr) {
        errors.push({ client_id: client.id, error: clientErr.message });
      }
    }

    return res.status(200).json({
      success: true,
      total_clients: activeClients.length,
      sent: sentCount,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
