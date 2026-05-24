const crypto = require('crypto');
const { supabase } = require('../lib/supabase');
const { needsEscalation } = require('../lib/utils');
const { notifyMaddy } = require('../lib/escalation');
const { maskPhone } = require('../lib/whatsapp');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

function generateCheckinToken(clientId, weekNo) {
  return crypto
    .createHmac('sha256', process.env.CHECKIN_SECRET)
    .update(`${clientId}${weekNo}`)
    .digest('hex');
}

module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    return res.end();
  }

  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      client_id,
      week_no,
      token,
      weight,
      waist,
      compliance_score,
      energy,
      issues,
      photos
    } = req.body || {};

    // --- Validate required fields ---
    if (!client_id || !week_no || !token) {
      return res.status(400).json({ error: 'Missing required fields: client_id, week_no, token' });
    }

    // --- Validate token ---
    const expectedToken = generateCheckinToken(client_id, week_no);
    if (token !== expectedToken) {
      console.warn(`Invalid check-in token for client ${client_id}, week ${week_no}`);
      return res.status(403).json({ error: 'Invalid or expired check-in link' });
    }

    // --- Validate client exists and is active ---
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('id, name, phone, status, program')
      .eq('id', client_id)
      .single();

    if (clientErr || !client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    if (client.status !== 'active') {
      return res.status(403).json({ error: 'Client is not active' });
    }

    // --- Check for duplicate check-in ---
    const { data: existing } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .limit(1);

    if (existing && existing.length > 0) {
      return res.status(409).json({ error: 'Check-in already submitted for this week' });
    }

    // --- Upload photos to Supabase Storage ---
    const photoUrls = [];

    if (photos && Array.isArray(photos) && photos.length > 0) {
      for (let i = 0; i < photos.length; i++) {
        const base64Data = photos[i];
        if (!base64Data) continue;

        // Strip data URI prefix if present
        const raw = base64Data.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(raw, 'base64');
        const filePath = `clients/${client_id}/week_${week_no}/photo_${i + 1}.jpg`;

        const { error: uploadErr } = await supabase.storage
          .from('checkin-photos')
          .upload(filePath, buffer, {
            contentType: 'image/jpeg',
            upsert: true
          });

        if (uploadErr) {
          console.error(`Photo upload failed (${filePath}):`, uploadErr.message);
        } else {
          const { data: urlData } = supabase.storage
            .from('checkin-photos')
            .getPublicUrl(filePath);

          if (urlData?.publicUrl) {
            photoUrls.push(urlData.publicUrl);
          }
        }
      }
    }

    // --- Check for escalation keywords in issues ---
    let escalated = false;
    if (needsEscalation(issues)) {
      escalated = true;
      console.warn(`Escalation triggered for client ${client_id} week ${week_no}: "${issues}"`);
      try {
        await notifyMaddy(
          'Check-in Escalation',
          `Client: ${client.name} (${maskPhone(client.phone)})\nWeek: ${week_no}\nIssues: ${issues}`
        );
      } catch (escErr) {
        console.error('Escalation notification failed:', escErr.message);
      }
    }

    // --- Insert check-in record ---
    const { data: checkin, error: insertErr } = await supabase
      .from('checkins')
      .insert({
        client_id,
        week_no,
        weight: weight || null,
        waist: waist || null,
        compliance_score: compliance_score || null,
        energy: energy || null,
        issues: issues || null,
        photos_urls: photoUrls,
        form_submitted_at: new Date().toISOString()
      })
      .select('id')
      .single();

    if (insertErr) {
      console.error('Check-in insert failed:', insertErr.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    console.log(`Check-in saved: client=${client_id}, week=${week_no}, id=${checkin.id}`);

    // --- Trigger program generation for 12wk clients ---
    if (client.program === '12wk') {
      console.log(`12wk client ${client_id} — triggering program generation for week ${week_no}`);

      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';

        fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.INTERNAL_API_KEY
          },
          body: JSON.stringify({ client_id, week_no })
        }).catch((err) => {
          console.error('Program generation trigger failed:', err.message);
        });
      } catch (triggerErr) {
        console.error('Program generation trigger error:', triggerErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Check-in submitted successfully',
      checkin_id: checkin.id,
      escalated
    });
  } catch (err) {
    console.error('Check-in submit error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
