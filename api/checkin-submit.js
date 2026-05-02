const { getSupabase } = require('../lib/supabase');
const { sendText } = require('../lib/whatsapp');
const { logMessage } = require('../lib/messages');
const { maskPhone, needsEscalation } = require('../lib/utils');

const MADDY_PHONE = '917082478374';

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos_urls,
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    await db.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no, 10),
      form_submitted_at: new Date().toISOString(),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score, 10) : null,
      energy: energy ? parseInt(energy, 10) : null,
      issues: issues || null,
      photos_urls: photos_urls || [],
    });

    if (issues && needsEscalation(issues)) {
      await sendText(MADDY_PHONE,
        `🚨 Check-in alert — ${client.name} (${maskPhone(client.phone)}) week ${week_no} reported: "${issues.slice(0, 200)}"`
      );
      await logMessage(MADDY_PHONE, 'out', 'Checkin escalation', 'escalation');
    }

    if (client.program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no, 10) }),
        });
      } catch (_) {
        // program generation runs async — failures are logged there
      }
    }

    const thankYou = client.market === 'IN'
      ? `Thanks for your check-in! 💪 Week ${week_no} data received. Naya program jaldi aayega!`
      : `Thanks for your check-in! 💪 Week ${week_no} data received. Your updated program is on the way!`;

    await sendText(client.phone, thankYou);
    await logMessage(client.phone, 'out', thankYou, 'checkin_confirm');

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
