const {
  supabaseFetch,
  supabaseStorageUpload,
  getClient,
  maskPhone,
  corsHeaders,
  handleCors,
} = require('./_lib/supabase');

/**
 * POST /api/checkin-submit
 * Weekly check-in form submission
 * Fields: client_id, week_no, weight, waist, compliance_score (1-10), energy (1-10), issues, photos
 */
export default async function handler(req, res) {
  if (handleCors(req, res)) return;

  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

    // Validate required fields
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no are required' });
    }

    if (compliance_score && (compliance_score < 1 || compliance_score > 10)) {
      return res.status(400).json({ error: 'compliance_score must be between 1 and 10' });
    }

    if (energy && (energy < 1 || energy > 10)) {
      return res.status(400).json({ error: 'energy must be between 1 and 10' });
    }

    // Validate client exists and is active
    const client = await getClient(client_id);
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    if (client.status !== 'active') {
      return res.status(403).json({ error: 'Client is not active' });
    }

    // Upload photos to Supabase Storage
    const photoUrls = [];
    if (photos && Array.isArray(photos) && photos.length > 0) {
      for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];
        const storagePath = `clients/${client_id}/week_${week_no}/photo_${i + 1}.jpg`;

        try {
          if (photo.startsWith('http')) {
            // It's a URL - store the reference
            photoUrls.push(photo);
          } else {
            // It's base64 - decode and upload
            const buffer = Buffer.from(photo, 'base64');
            await supabaseStorageUpload('checkins', storagePath, buffer, 'image/jpeg');
            photoUrls.push(`${process.env.SUPABASE_URL}/storage/v1/object/public/checkins/${storagePath}`);
          }
        } catch (uploadErr) {
          console.error(`Photo upload failed for ${storagePath}:`, uploadErr.message);
          // Continue with remaining photos
        }
      }
    }

    // Insert check-in record
    const checkinData = {
      client_id,
      week_no: Number(week_no),
      weight: weight ? Number(weight) : null,
      waist: waist ? Number(waist) : null,
      compliance_score: compliance_score ? Number(compliance_score) : null,
      energy: energy ? Number(energy) : null,
      issues: issues || null,
      photos: photoUrls.length > 0 ? photoUrls : null,
      submitted_at: new Date().toISOString(),
    };

    const result = await supabaseFetch('/checkins', {
      method: 'POST',
      body: checkinData,
    });

    console.log(`Check-in submitted: client=${client_id}, week=${week_no}`);

    // If client is on 12-week program, trigger program generation for next week
    if (client.program === '12wk_flagship' || client.program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'http://localhost:3000';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id,
            week_no: Number(week_no) + 1,
          }),
        });

        console.log(`Program generation triggered for client=${client_id}, week=${Number(week_no) + 1}`);
      } catch (genErr) {
        console.error('Program generation trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      checkin: result && result.length > 0 ? result[0] : checkinData,
    });
  } catch (error) {
    console.error('checkin-submit error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
