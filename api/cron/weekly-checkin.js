const { supabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { escalateToMaddy } = require('../../lib/escalation');
const { maskPhone, jsonResponse } = require('../../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse(res, { error: 'Method not allowed' }, 405);
  }

  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return jsonResponse(res, { error: 'Unauthorized' }, 401);
  }

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return jsonResponse(res, { action: 'no_active_clients' });
    }

    const results = [];

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) continue;

      const { data: lastCheckin } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(1)
        .single();

      const lastWeek = lastCheckin?.week_no || 0;

      if (lastWeek >= currentWeek) {
        results.push({ client_id: client.id, action: 'already_submitted' });
        continue;
      }

      const { data: missedCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id);

      const submittedWeeks = (missedCheckins || []).map(c => c.week_no);
      const missedCount = Array.from({ length: currentWeek - 1 }, (_, i) => i + 1)
        .filter(w => !submittedWeeks.includes(w)).length;

      if (missedCount >= 2) {
        await escalateToMaddy('2 consecutive missed check-ins', {
          clientPhone: client.phone,
          name: client.name,
          details: `${missedCount} missed check-ins out of ${currentWeek - 1} weeks`
        });
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;
      const market = client.phone?.startsWith('+91') || client.phone?.startsWith('91') ? 'IN' : 'GLOBAL';

      const params = market === 'IN'
        ? [client.name || 'there', `Week ${currentWeek}`, checkinUrl, 'Apna weekly check-in fill karo — photos aur stats ke saath!']
        : [client.name || 'there', `Week ${currentWeek}`, checkinUrl, 'Time for your weekly check-in — share your stats and photos!'];

      await sendWhatsApp(client.phone, 'weekly_checkin', params);

      results.push({ client_id: client.id, week: currentWeek, action: 'sent' });
      console.log(`Check-in sent: ${maskPhone(client.phone)} week=${currentWeek}`);
    }

    return jsonResponse(res, { success: true, processed: results.length, results });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return jsonResponse(res, { error: 'Internal error' }, 500);
  }
};
