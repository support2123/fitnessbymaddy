const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, detectMarket, isHinglish } = require('../lib/whatsapp');
const { cors } = require('../lib/utils');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const {
    client_id, week_no, weight, waist,
    compliance_score, energy, issues, photos_urls,
  } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'Missing client_id or week_no' });
  }

  const db = getSupabase();

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) return res.status(404).json({ error: 'Client not found' });

  const { data: existing } = await db
    .from('checkins')
    .select('id')
    .eq('client_id', client_id)
    .eq('week_no', parseInt(week_no))
    .single();

  if (existing) {
    return res.status(409).json({ error: 'Check-in already submitted for this week' });
  }

  const needsEscalation = issues && /pain|dizz|disorder|not eating|throwing up|hurt|bleed/i.test(issues);

  await db.from('checkins').insert({
    client_id,
    week_no: parseInt(week_no),
    weight: weight ? parseFloat(weight) : null,
    waist: waist ? parseFloat(waist) : null,
    compliance_score: compliance_score ? parseInt(compliance_score) : null,
    energy: energy ? parseInt(energy) : null,
    issues: issues || null,
    photos_urls: photos_urls || [],
  });

  if (needsEscalation) {
    await sendWhatsApp(
      process.env.MADDY_PHONE || '+917082478374',
      'escalation_alert',
      [client.name || 'Client', `Week ${week_no} check-in concern`, issues.slice(0, 200)]
    );
  }

  const market = detectMarket(client.phone);
  const hinglish = isHinglish(market);

  const ackParams = hinglish
    ? [client.name || 'there', `Week ${week_no}`, 'Check-in mil gaya! Aapka updated program jald aayega.']
    : [client.name || 'there', `Week ${week_no}`, 'Check-in received! Your updated program is on its way.'];
  await sendWhatsApp(client.phone, 'checkin_ack', ackParams);

  if (client.program === '12wk') {
    try {
      await fetch(`https://www.fitnessbymaddy.com/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
        },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
      });
    } catch (_) {}
  }

  return res.status(200).json({ success: true, escalated: !!needsEscalation });
};
