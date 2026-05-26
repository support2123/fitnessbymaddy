const supabase = require('../lib/supabase');
const { needsEscalation, getEscalationReason, notifyMaddy, checkConsecutiveMissedCheckins } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos
    } = body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    // Verify client exists and is active
    const { data: client } = await supabase
      .from('clients')
      .select('id, phone, name, program, status')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    if (client.status !== 'active') {
      return res.status(400).json({ error: 'Client is not active' });
    }

    // Upload photos if provided (base64 encoded)
    const photoUrls = [];
    if (photos && Array.isArray(photos)) {
      for (let i = 0; i < Math.min(photos.length, 3); i++) {
        const photoData = photos[i];
        if (!photoData) continue;

        const base64 = photoData.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64, 'base64');
        const ext = photoData.startsWith('data:image/png') ? 'png' : 'jpg';
        const path = `${client_id}/checkin_w${week_no}_${i + 1}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from('clients')
          .upload(path, buffer, {
            contentType: `image/${ext === 'png' ? 'png' : 'jpeg'}`,
            upsert: true
          });

        if (!uploadError) {
          const { data: urlData } = supabase.storage
            .from('clients')
            .getPublicUrl(path);
          photoUrls.push(urlData.publicUrl);
        }
      }
    }

    // Escalation check on issues
    if (issues && needsEscalation(issues)) {
      const reason = getEscalationReason(issues);
      await notifyMaddy(client.phone, `Check-in W${week_no}: ${issues}`, reason);
    }

    // Save check-in
    const { data, error } = await supabase.from('checkins').upsert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photoUrls,
      form_submitted_at: new Date().toISOString()
    }, {
      onConflict: 'client_id,week_no'
    }).select().single();

    if (error) {
      console.error('Check-in save error:', error);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    // Trigger program generation for 12-week clients
    if (client.program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
        });
      } catch (genErr) {
        console.error('Program generation trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({ ok: true, id: data.id });

  } catch (err) {
    console.error('Check-in error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
