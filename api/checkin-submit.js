const { getClient } = require('../lib/supabase');
const { sendText, sendToMaddy } = require('../lib/whatsapp');
const { isHinglish } = require('../lib/market');
const { needsEscalation, getEscalationReason } = require('../lib/escalation');
const { maskPhone } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sb = getClient();
  const {
    client_id, week_no, weight, waist,
    compliance_score, energy, issues, photos_urls
  } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no are required' });
  }

  const { data: client } = await sb
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) return res.status(404).json({ error: 'Client not found' });

  if (issues && needsEscalation(issues)) {
    const reason = getEscalationReason(issues);
    await sendToMaddy(
      `CHECKIN ESCALATION [${reason}]\nClient: ${client.name || maskPhone(client.phone)}\nWeek: ${week_no}\nIssue: "${issues.substring(0, 300)}"`
    );
  }

  const { data: checkin } = await sb.from('checkins').insert({
    client_id,
    week_no: parseInt(week_no, 10),
    form_submitted_at: new Date().toISOString(),
    weight: weight ? parseFloat(weight) : null,
    waist: waist ? parseFloat(waist) : null,
    compliance_score: compliance_score ? parseInt(compliance_score, 10) : null,
    energy: energy ? parseInt(energy, 10) : null,
    issues: issues || null,
    photos_urls: photos_urls || [],
    next_week_focus: null
  }).select().single();

  const hinglish = client.phone && isHinglish(require('../lib/market').detectMarket(client.phone));
  const ack = hinglish
    ? `Week ${week_no} check-in mil gaya! Aapka naya plan jaldi aayega.`
    : `Week ${week_no} check-in received! Your updated plan will be ready soon.`;
  await sendText(client.phone, ack);

  if (client.program === '12wk') {
    try {
      const origin = `https://${req.headers.host}`;
      await fetch(`${origin}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-key': process.env.SUPABASE_SERVICE_KEY
        },
        body: JSON.stringify({
          client_id,
          week_no: parseInt(week_no, 10) + 1
        })
      });
    } catch (err) {
      console.error('Program generation trigger failed:', err.message);
    }
  }

  return res.status(200).json({ ok: true, checkinId: checkin?.id });
};
