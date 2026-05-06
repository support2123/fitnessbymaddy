const { getSupabase } = require('./_lib/supabase');
const { jsonResponse, errorResponse, corsHeaders } = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(200).end();
  }
  if (req.method !== 'POST') return errorResponse(res, 'POST only', 405);

  const db = getSupabase();

  // Handle multipart for photo uploads
  const contentType = req.headers['content-type'] || '';
  let fields = {};
  let photoUrls = [];

  if (contentType.includes('application/json')) {
    fields = req.body || {};
    photoUrls = fields.photos_urls || [];
  } else {
    // For form-encoded or multipart, Vercel parses body
    fields = req.body || {};
  }

  const { client_id, week_no, weight, waist, compliance_score, energy, issues, next_week_focus } = fields;

  if (!client_id || !week_no) {
    return errorResponse(res, 'client_id and week_no are required');
  }

  // Verify client exists and is active
  const { data: client } = await db
    .from('clients')
    .select('id, phone, name, program, status')
    .eq('id', client_id)
    .single();

  if (!client) return errorResponse(res, 'Client not found', 404);
  if (client.status !== 'active') return errorResponse(res, 'Client is not active');

  // Handle photo uploads to Supabase Storage
  if (fields.photos && Array.isArray(fields.photos)) {
    for (let i = 0; i < fields.photos.length && i < 3; i++) {
      const photoData = fields.photos[i];
      if (photoData && photoData.startsWith('data:')) {
        const matches = photoData.match(/^data:(.+);base64,(.+)$/);
        if (matches) {
          const mimeType = matches[1];
          const ext = mimeType.split('/')[1] || 'jpg';
          const buffer = Buffer.from(matches[2], 'base64');
          const path = `${client_id}/week_${week_no}_photo_${i + 1}.${ext}`;

          const { data: uploaded } = await db.storage
            .from('clients')
            .upload(path, buffer, { contentType: mimeType, upsert: true });

          if (uploaded) {
            const { data: urlData } = db.storage
              .from('clients')
              .getPublicUrl(path);
            if (urlData) photoUrls.push(urlData.publicUrl);
          }
        }
      }
    }
  }

  // Check for duplicate submission
  const { data: existing } = await db
    .from('checkins')
    .select('id')
    .eq('client_id', client_id)
    .eq('week_no', parseInt(week_no))
    .limit(1)
    .single();

  if (existing) {
    // Update existing check-in
    await db.from('checkins').update({
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photoUrls,
      next_week_focus: next_week_focus || null,
      form_submitted_at: new Date().toISOString()
    }).eq('id', existing.id);
  } else {
    await db.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photoUrls,
      next_week_focus: next_week_focus || null
    });
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
    } catch (err) {
      console.error('[Checkin] Failed to trigger program generation:', err.message);
    }
  }

  return jsonResponse(res, {
    ok: true,
    message: 'Check-in submitted successfully'
  });
};
