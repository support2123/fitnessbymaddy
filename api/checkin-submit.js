const { getClient } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { cors, parseBody, maskPhone } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = await parseBody(req);
  const { client_id, week_no, weight, waist, compliance_score, energy, issues, photos_urls } = body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'Missing client_id or week_no' });
  }

  const db = getClient();

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) {
    return res.status(404).json({ error: 'Client not found' });
  }

  if (client.status !== 'active') {
    return res.status(400).json({ error: 'Client is not active' });
  }

  // Check for escalation keywords in issues
  const escalationWords = ['pain', 'dizzy', 'dizziness', 'injury', 'hurt', 'bleeding', 'nausea', 'vomit'];
  const needsEscalation = issues && escalationWords.some((w) => issues.toLowerCase().includes(w));

  const { data: checkin, error } = await db
    .from('checkins')
    .insert({
      client_id,
      week_no: parseInt(week_no, 10),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score, 10) : null,
      energy: energy ? parseInt(energy, 10) : null,
      issues: issues || null,
      photos_urls: photos_urls || [],
    })
    .select()
    .single();

  if (error) {
    console.error('[CHECKIN]', error.message);
    return res.status(500).json({ error: 'Failed to save check-in' });
  }

  console.log(`[CHECKIN] ${maskPhone(client.phone)} week ${week_no}`);

  if (needsEscalation) {
    await sendTemplate(process.env.MADDY_PHONE || '+917082478374', 'escalation_alert', [
      maskPhone(client.phone),
      `Week ${week_no} check-in flagged: ${issues.slice(0, 200)}`,
    ]);
  }

  // For 12-week clients, trigger program generation
  if (client.program === '12wk') {
    try {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://fitnessbymaddy.com';

      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no, 10) + 1 }),
      });
    } catch (err) {
      console.error('[PROGRAM-TRIGGER]', err.message);
    }
  }

  // Send confirmation to client
  await sendTemplate(client.phone, 'checkin_received', [
    client.name || 'there',
    String(week_no),
  ]);

  return res.status(200).json({
    success: true,
    message: 'Check-in submitted! Your coach will review it shortly.',
    checkin_id: checkin.id,
  });
};
