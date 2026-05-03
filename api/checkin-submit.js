const { supabase } = require('../lib/supabase');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no are required' });
    }

    // Verify client exists and is active
    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });
    if (client.status !== 'active') return res.status(400).json({ error: 'Client is not active' });

    // Upload photos to Supabase Storage
    const photoUrls = [];
    if (photos && Array.isArray(photos)) {
      for (let i = 0; i < Math.min(photos.length, 5); i++) {
        const photo = photos[i];
        if (!photo.data) continue;
        const buffer = Buffer.from(photo.data, 'base64');
        const path = `clients/${client_id}/checkin_w${week_no}_${i + 1}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from('clients')
          .upload(path, buffer, {
            contentType: 'image/jpeg',
            upsert: true
          });
        if (!uploadError) {
          const { data: urlData } = supabase.storage.from('clients').getPublicUrl(path);
          photoUrls.push(urlData.publicUrl);
        }
      }
    }

    // Check for escalation triggers
    if (issues && needsEscalation(issues)) {
      await escalateToMaddy('Issue flagged in weekly check-in', {
        name: client.name,
        phone: client.phone,
        details: `Week ${week_no}: ${issues}`
      });
    }

    // Check for low compliance / missed check-ins
    if (compliance_score && parseInt(compliance_score) <= 3) {
      await escalateToMaddy('Very low compliance score', {
        name: client.name,
        phone: client.phone,
        details: `Week ${week_no} compliance: ${compliance_score}/10`
      });
    }

    // Save check-in
    const { data, error } = await supabase.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photoUrls
    }).select().single();

    if (error) throw error;

    // Trigger program generation for 12-week clients
    if (client.program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
        });
      } catch (e) {
        console.error('Program generation trigger failed:', e.message);
      }
    }

    return res.status(200).json({ ok: true, id: data.id });
  } catch (err) {
    console.error('Check-in error:', err.message);
    return res.status(500).json({ error: 'Failed to save check-in' });
  }
};
