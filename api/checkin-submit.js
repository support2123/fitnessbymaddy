const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { shouldEscalate, notifyMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabase();
  const {
    client_id, week_no, weight, waist, compliance_score,
    energy, issues, photos_urls
  } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'Missing client_id or week_no' });
  }

  const { data: client } = await supabase
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .eq('status', 'active')
    .single();

  if (!client) return res.status(404).json({ error: 'Active client not found' });

  // Check for escalation keywords in issues
  if (issues && shouldEscalate(issues)) {
    await notifyMaddy('Check-in concern', {
      name: client.name,
      phone: client.phone,
      message: issues
    });
  }

  // Insert check-in
  const { data: checkin, error } = await supabase.from('checkins').insert({
    client_id,
    week_no: parseInt(week_no),
    form_submitted_at: new Date().toISOString(),
    weight: parseFloat(weight) || null,
    waist: parseFloat(waist) || null,
    compliance_score: parseInt(compliance_score) || null,
    energy: parseInt(energy) || null,
    issues: issues || null,
    photos_urls: photos_urls || []
  }).select().single();

  if (error) return res.status(500).json({ error: 'Failed to save check-in' });

  // Trigger program generation for 12-week clients
  if (client.program === '12wk') {
    const generateUrl = `${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'https://www.fitnessbymaddy.com'}/api/generate-program`;
    fetch(generateUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
    }).catch(() => {});
  }

  // Send confirmation
  await sendWhatsApp(client.phone, 'checkin_received', {
    name: client.name,
    templateParams: [client.name, String(week_no)]
  }).catch(() => {});

  return res.status(200).json({ success: true, checkin_id: checkin.id });
};
