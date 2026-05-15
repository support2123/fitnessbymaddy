const { getSupabase } = require('../lib/supabase');
const { jsonResponse, errorResponse } = require('../lib/utils');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');
const { maskPhone } = require('../lib/whatsapp');

module.exports = async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }});
  }

  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  const contentType = req.headers.get('content-type') || '';
  let data;

  if (contentType.includes('multipart/form-data')) {
    const formData = await req.formData();
    data = Object.fromEntries(formData.entries());

    // Handle photo uploads
    const photoUrls = [];
    const db = getSupabase();
    for (let i = 1; i <= 3; i++) {
      const file = formData.get(`photo_${i}`);
      if (file && file.size > 0) {
        const ext = file.name.split('.').pop();
        const path = `checkins/${data.client_id}/week_${data.week_no}/photo_${i}.${ext}`;
        const buffer = Buffer.from(await file.arrayBuffer());
        const { data: uploaded, error } = await db.storage
          .from('client-files')
          .upload(path, buffer, { contentType: file.type, upsert: true });
        if (!error) {
          const { data: urlData } = db.storage.from('client-files').getPublicUrl(path);
          photoUrls.push(urlData.publicUrl);
        }
      }
    }
    data.photos_urls = photoUrls;
  } else {
    data = await req.json();
  }

  if (!data.client_id || !data.week_no) {
    return errorResponse('Missing client_id or week_no');
  }

  const db = getSupabase();

  // Verify client
  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', data.client_id)
    .eq('status', 'active')
    .single();

  if (!client) return errorResponse('Active client not found', 404);

  // Check for escalation triggers in issues
  if (data.issues && needsEscalation(data.issues)) {
    await escalateToMaddy('Check-in issue trigger', {
      phone: maskPhone(client.phone),
      client_id: client.id,
      week: data.week_no,
      issue: data.issues
    });
  }

  // Upsert check-in
  const checkinData = {
    client_id: data.client_id,
    week_no: parseInt(data.week_no),
    weight: data.weight ? parseFloat(data.weight) : null,
    waist: data.waist ? parseFloat(data.waist) : null,
    compliance_score: data.compliance_score ? parseInt(data.compliance_score) : null,
    energy: data.energy ? parseInt(data.energy) : null,
    issues: data.issues || null,
    photos_urls: data.photos_urls || [],
    form_submitted_at: new Date().toISOString()
  };

  const { data: existing } = await db
    .from('checkins')
    .select('id')
    .eq('client_id', data.client_id)
    .eq('week_no', parseInt(data.week_no))
    .single();

  if (existing) {
    await db.from('checkins').update(checkinData).eq('id', existing.id);
  } else {
    await db.from('checkins').insert(checkinData);
  }

  // Trigger program generation for 12-week clients
  if (client.program === '12wk') {
    try {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://fitnessbymaddy.com';
      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_SECRET}`
        },
        body: JSON.stringify({ client_id: client.id, week_no: parseInt(data.week_no) + 1 })
      });
    } catch (e) {
      console.error('Failed to trigger program generation:', e.message);
    }
  }

  return jsonResponse({ success: true, message: 'Check-in submitted' });
};
