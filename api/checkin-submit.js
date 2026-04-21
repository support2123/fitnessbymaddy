import supabase from '../lib/supabase.js';
import { needsEscalation, escalateToMaddy } from '../lib/escalation.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id,
      week_no,
      weight,
      waist,
      compliance_score,
      energy,
      issues,
      photos,
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

    if (!client) {
      return res.status(404).json({ error: 'Active client not found' });
    }

    let photoUrls = [];
    if (photos && Array.isArray(photos)) {
      for (let i = 0; i < photos.length && i < 5; i++) {
        const photo = photos[i];
        if (!photo.data || !photo.name) continue;

        const buffer = Buffer.from(photo.data, 'base64');
        const path = `${client_id}/week_${week_no}_photo_${i + 1}.jpg`;

        await supabase.storage.from('clients').upload(path, buffer, {
          contentType: photo.type || 'image/jpeg',
          upsert: true,
        });

        const { data: urlData } = supabase.storage.from('clients').getPublicUrl(path);
        if (urlData?.publicUrl) photoUrls.push(urlData.publicUrl);
      }
    }

    const { data: checkin, error } = await supabase
      .from('checkins')
      .upsert(
        {
          client_id,
          week_no: parseInt(week_no),
          weight: weight ? parseFloat(weight) : null,
          waist: waist ? parseFloat(waist) : null,
          compliance_score: compliance_score ? parseInt(compliance_score) : null,
          energy: energy ? parseInt(energy) : null,
          issues: issues || null,
          photos_urls: photoUrls,
          form_submitted_at: new Date().toISOString(),
        },
        { onConflict: 'client_id,week_no' }
      )
      .select()
      .single();

    if (error) {
      console.error('Checkin insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    if (issues && needsEscalation(issues)) {
      await escalateToMaddy('Client reported concerning issue in check-in', {
        phone: client.phone,
        name: client.name,
        message: issues,
      });
    }

    if (client.program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.INTERNAL_API_KEY}`,
          },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
        });
      } catch (genErr) {
        console.error('Program generation trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, checkin_id: checkin?.id });
  } catch (err) {
    console.error('Checkin submit error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
