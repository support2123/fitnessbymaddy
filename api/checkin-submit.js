import supabase from './_lib/supabase.js';
import { jsonResponse, parseBody } from './_lib/helpers.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'Method not allowed' });

  try {
    const body = await parseBody(req);

    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues,
    } = body;

    if (!client_id || !week_no) {
      return jsonResponse(res, 400, { error: 'Missing client_id or week_no' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return jsonResponse(res, 404, { error: 'Client not found' });
    if (client.status !== 'active') {
      return jsonResponse(res, 400, { error: 'Client program is not active' });
    }

    let photosUrls = [];
    if (body.photos && Array.isArray(body.photos)) {
      for (let i = 0; i < body.photos.length && i < 5; i++) {
        const photo = body.photos[i];
        if (!photo.data || !photo.name) continue;

        const buffer = Buffer.from(photo.data, 'base64');
        const filePath = `clients/${client_id}/checkin_w${week_no}_${i + 1}_${photo.name}`;

        const { error: uploadErr } = await supabase.storage
          .from('clients')
          .upload(filePath, buffer, {
            contentType: photo.type || 'image/jpeg',
            upsert: true,
          });

        if (!uploadErr) {
          const { data: urlData } = supabase.storage
            .from('clients')
            .getPublicUrl(filePath);
          photosUrls.push(urlData.publicUrl);
        }
      }
    }

    const { data: existingCheckin } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no))
      .single();

    const checkinData = {
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photosUrls,
      form_submitted_at: new Date().toISOString(),
    };

    let result;
    if (existingCheckin) {
      result = await supabase
        .from('checkins')
        .update(checkinData)
        .eq('id', existingCheckin.id)
        .select()
        .single();
    } else {
      result = await supabase
        .from('checkins')
        .insert(checkinData)
        .select()
        .single();
    }

    if (result.error) {
      console.error('Checkin save error:', result.error.message);
      return jsonResponse(res, 500, { error: 'Failed to save check-in' });
    }

    if (client.program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
          },
          body: JSON.stringify({
            client_id,
            week_no: parseInt(week_no) + 1,
          }),
        });
      } catch (genErr) {
        console.error('Program generation trigger failed:', genErr.message);
      }
    }

    return jsonResponse(res, 200, {
      success: true,
      checkin_id: result.data.id,
    });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return jsonResponse(res, 500, { error: 'Internal server error' });
  }
}
