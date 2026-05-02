const { getSupabase } = require('./lib/supabase');
const { needsEscalation, escalateToMaddy } = require('./lib/escalation');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabase();
  const {
    client_id, week_no, weight, waist,
    compliance_score, energy, issues, photos
  } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'Missing client_id or week_no' });
  }

  const { data: client } = await supabase
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client || client.status !== 'active') {
    return res.status(404).json({ error: 'Active client not found' });
  }

  let photosUrls = [];
  if (photos && photos.length > 0) {
    for (let i = 0; i < photos.length; i++) {
      const photoData = photos[i];
      const path = `clients/${client_id}/checkins/week_${week_no}_photo_${i + 1}.jpg`;
      const buffer = Buffer.from(photoData.replace(/^data:image\/\w+;base64,/, ''), 'base64');
      await supabase.storage
        .from('client-files')
        .upload(path, buffer, { contentType: 'image/jpeg', upsert: true });
      const { data: urlData } = supabase.storage
        .from('client-files')
        .getPublicUrl(path);
      photosUrls.push(urlData.publicUrl);
    }
  }

  const { error } = await supabase.from('checkins').insert({
    client_id,
    week_no: parseInt(week_no),
    form_submitted_at: new Date().toISOString(),
    weight: weight || null,
    waist: waist || null,
    compliance_score: compliance_score || null,
    energy: energy || null,
    issues: issues || null,
    photos_urls: photosUrls
  });

  if (error) {
    return res.status(500).json({ error: 'Failed to save check-in' });
  }

  if (issues && needsEscalation(issues)) {
    await escalateToMaddy('Check-in issue flagged', {
      phone: client.phone,
      message: issues
    });
  }

  if (client.program === '12wk') {
    try {
      const origin = `https://${req.headers.host}`;
      await fetch(`${origin}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
      });
    } catch (e) {
      // Program generation is async; failure logged separately
    }
  }

  return res.status(200).json({ success: true, message: 'Check-in submitted' });
};
