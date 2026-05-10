const { getSupabase } = require('../lib/supabase');
const { needsEscalation, parseBody, jsonResp, corsHeaders } = require('../lib/helpers');
const { escalateToMaddy } = require('../lib/escalate');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return jsonResp(res, 405, { error: 'Method not allowed' });

  const db = getSupabase();
  let body;
  try {
    body = await parseBody(req);
  } catch {
    return jsonResp(res, 400, { error: 'Invalid request body' });
  }

  const clientId = body.client_id;
  const weekNo = parseInt(body.week_no, 10);
  if (!clientId || !weekNo) {
    return jsonResp(res, 400, { error: 'Missing client_id or week_no' });
  }

  const { data: client } = await db
    .from('clients')
    .select('id, phone, name, program')
    .eq('id', clientId)
    .single();

  if (!client) return jsonResp(res, 404, { error: 'Client not found' });

  const photoUrls = [];
  if (body.photos && Array.isArray(body.photos)) {
    for (const photo of body.photos.slice(0, 3)) {
      if (photo.data && photo.name) {
        const buffer = Buffer.from(photo.data, 'base64');
        const path = `clients/${clientId}/checkins/week_${weekNo}/${photo.name}`;
        const { data: upload } = await db.storage
          .from('client-files')
          .upload(path, buffer, { contentType: photo.type || 'image/jpeg', upsert: true });
        if (upload) {
          const { data: urlData } = db.storage.from('client-files').getPublicUrl(path);
          photoUrls.push(urlData.publicUrl);
        }
      }
    }
  }

  const checkin = {
    client_id: clientId,
    week_no: weekNo,
    form_submitted_at: new Date().toISOString(),
    weight: body.weight ? parseFloat(body.weight) : null,
    waist: body.waist ? parseFloat(body.waist) : null,
    compliance_score: body.compliance_score ? parseInt(body.compliance_score, 10) : null,
    energy: body.energy ? parseInt(body.energy, 10) : null,
    issues: body.issues || '',
    photos_urls: photoUrls,
    next_week_focus: body.next_week_focus || '',
  };

  const { data: saved, error } = await db.from('checkins').insert(checkin).select().single();
  if (error) return jsonResp(res, 500, { error: 'Failed to save check-in' });

  if (needsEscalation(body.issues)) {
    await escalateToMaddy('Client check-in health concern', {
      phone: client.phone,
      name: client.name,
      message: body.issues,
    });
  }

  if (client.program === '12wk') {
    try {
      const baseUrl = `https://${req.headers.host}`;
      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, week_no: weekNo + 1 }),
      });
    } catch (e) {
      console.error('Program generation trigger failed:', e.message);
    }
  }

  return jsonResp(res, 200, {
    success: true,
    checkin_id: saved.id,
    message: 'Check-in submitted successfully!',
  });
};
