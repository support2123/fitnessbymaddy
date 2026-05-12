const { supabase } = require('../lib/supabase');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, token
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

    const { data: existing } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .single();

    if (existing) return res.status(409).json({ error: 'Check-in already submitted for this week' });

    let photosUrls = [];
    if (req.body.photos && Array.isArray(req.body.photos)) {
      for (let i = 0; i < req.body.photos.length && i < 3; i++) {
        const photo = req.body.photos[i];
        if (photo.base64 && photo.name) {
          const buffer = Buffer.from(photo.base64, 'base64');
          const path = `${client_id}/checkins/week_${week_no}_${i + 1}_${photo.name}`;
          const { data: upload } = await supabase.storage
            .from('clients')
            .upload(path, buffer, { contentType: photo.type || 'image/jpeg', upsert: true });
          if (upload) {
            const { data: urlData } = supabase.storage.from('clients').getPublicUrl(path);
            photosUrls.push(urlData.publicUrl);
          }
        }
      }
    }

    const { data: checkin, error } = await supabase.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photosUrls
    }).select().single();

    if (error) throw error;

    if (issues && needsEscalation(issues)) {
      await escalateToMaddy('Concerning check-in report', {
        name: client.name,
        phone: client.phone,
        message: `Week ${week_no}: ${issues}`
      });
    }

    if (client.program === '12wk') {
      fetch(`https://fitnessbymaddy.com/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
      }).catch(() => {});
    }

    return res.status(200).json({ success: true, checkin_id: checkin.id });

  } catch (err) {
    console.error('Check-in error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
