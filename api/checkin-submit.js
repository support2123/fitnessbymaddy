const { getSupabase } = require('./lib/supabase');
const { needsEscalation, escalateToMaddy } = require('./lib/escalation');
const { maskPhone } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabase = getSupabase();
  const {
    client_id, week_no, weight, waist,
    compliance_score, energy, issues, photos_urls,
  } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'Missing client_id or week_no' });
  }

  // Verify client exists
  const { data: client } = await supabase
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) {
    return res.status(404).json({ error: 'Client not found' });
  }

  // Check for escalation keywords in issues
  if (issues && needsEscalation(issues)) {
    await escalateToMaddy({
      reason: 'Client check-in flagged concern',
      phone: maskPhone(client.phone),
      context: issues.slice(0, 100),
    });
  }

  // Save check-in
  const { data: checkin, error } = await supabase
    .from('checkins')
    .insert({
      client_id,
      week_no: parseInt(week_no),
      form_submitted_at: new Date().toISOString(),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photos_urls || [],
    })
    .select()
    .single();

  if (error) {
    return res.status(500).json({ error: 'Failed to save check-in' });
  }

  // Trigger program generation for 12-week clients
  if (client.program === '12wk') {
    try {
      await fetch(`${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : ''}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
      });
    } catch (e) {
      // Non-blocking - program generation is async
    }
  }

  return res.status(200).json({ success: true, checkin_id: checkin?.id });
};
