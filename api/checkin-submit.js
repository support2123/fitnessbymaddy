const { supabase } = require('./_lib/supabase');
const { escalate } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, next_week_focus
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    let photoUrls = [];
    if (req.body.photos && Array.isArray(req.body.photos)) {
      for (let i = 0; i < req.body.photos.length && i < 5; i++) {
        const photo = req.body.photos[i];
        if (photo && photo.startsWith('data:image')) {
          const base64Data = photo.split(',')[1];
          const buffer = Buffer.from(base64Data, 'base64');
          const ext = photo.includes('png') ? 'png' : 'jpg';
          const path = `clients/${client_id}/checkin_w${week_no}_${i}.${ext}`;

          await supabase.storage
            .from('client-data')
            .upload(path, buffer, {
              contentType: `image/${ext}`,
              upsert: true
            });

          const { data: urlData } = supabase.storage
            .from('client-data')
            .getPublicUrl(path);

          if (urlData) photoUrls.push(urlData.publicUrl);
        }
      }
    }

    const { data: checkin, error } = await supabase.from('checkins').upsert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      next_week_focus: next_week_focus || null,
      photos_urls: photoUrls,
      form_submitted_at: new Date().toISOString()
    }, { onConflict: 'client_id,week_no' }).select().single();

    if (error) throw error;

    if (issues) {
      const { needsEscalation } = require('./_lib/escalation');
      if (needsEscalation(issues)) {
        await escalate('Health concern in check-in', client.phone, issues.slice(0, 200));
      }
    }

    if (client.program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
          },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
        });
      } catch (genErr) {
        console.error('Program generation trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({ ok: true, checkin_id: checkin.id });

  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Failed to save check-in' });
  }
};
