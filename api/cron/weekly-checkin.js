const { supabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { notifyMaddy } = require('../../lib/escalation');
const { maskPhone } = require('../../lib/pii');
const { isHinglish } = require('../../lib/market');

const SITE_BASE = 'https://www.fitnessbymaddy.com';

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { data: activeClients, error } = await supabase
      .from('clients')
      .select('*, leads(market)')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (error) throw error;
    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let errors = 0;

    for (const client of activeClients) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

        if (weekNo < 1) continue;

        const { data: existingCheckin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (existingCheckin) continue;

        const checkinUrl = `${SITE_BASE}/checkin?c=${client.id}&w=${weekNo}`;
        const market = client.leads?.market || 'GLOBAL';

        const message = isHinglish(market)
          ? `Hey ${client.name || 'there'}! 📊 Week ${weekNo} check-in time!\n\nApna progress update karo — weight, waist, photos.\n\n${checkinUrl}\n\n5 min lagenge bas!`
          : `Hey ${client.name || 'there'}! 📊 Time for your Week ${weekNo} check-in!\n\nUpdate your progress — weight, waist, photos.\n\n${checkinUrl}\n\nTakes just 5 minutes!`;

        await sendWhatsApp(client.phone, message, 'weekly_checkin');
        sent++;

        const { data: missedCheckins } = await supabase
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(3);

        const submittedWeeks = (missedCheckins || []).map(c => c.week_no);
        let consecutiveMissed = 0;
        for (let w = weekNo - 1; w >= 1 && consecutiveMissed < 2; w--) {
          if (!submittedWeeks.includes(w)) consecutiveMissed++;
          else break;
        }

        if (consecutiveMissed >= 2) {
          await notifyMaddy(supabase, sendWhatsApp,
            '2 consecutive missed check-ins',
            `Client: ${maskPhone(client.phone)} (${client.name || 'Unknown'}) — ${client.program}`
          );
        }
      } catch (clientErr) {
        console.error(`Check-in send failed for ${maskPhone(client.phone)}:`, clientErr.message);
        errors++;
      }
    }

    return res.status(200).json({ sent, errors, total: activeClients.length });
  } catch (err) {
    console.error('weekly-checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
