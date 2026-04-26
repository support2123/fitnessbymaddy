const { getSupabase } = require('../lib/supabase');
const { needsEscalation } = require('../lib/helpers');
const { sendWhatsApp, maskPhone } = require('../lib/whatsapp');
const { logMessage } = require('../lib/messages');
const { corsHeaders } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).set(corsHeaders()).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    client_id,
    week_no,
    weight,
    waist,
    compliance_score,
    energy,
    issues,
    photos_urls,
  } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no required' });
  }

  const db = getSupabase();

  // Verify client exists and is active
  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .eq('status', 'active')
    .maybeSingle();

  if (!client) {
    return res.status(404).json({ error: 'Active client not found' });
  }

  // Check for duplicate check-in
  const { data: existing } = await db
    .from('checkins')
    .select('id')
    .eq('client_id', client_id)
    .eq('week_no', parseInt(week_no))
    .maybeSingle();

  if (existing) {
    // Update existing check-in
    await db.from('checkins').update({
      weight: weight || null,
      waist: waist || null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photos_urls || [],
      form_submitted_at: new Date().toISOString(),
    }).eq('id', existing.id);

    return res.status(200).json({ ok: true, checkin_id: existing.id, updated: true });
  }

  // Insert new check-in
  const { data: checkin, error } = await db
    .from('checkins')
    .insert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight || null,
      waist: waist || null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photos_urls || [],
    })
    .select()
    .single();

  if (error) {
    console.error('Checkin insert error:', error.message);
    return res.status(500).json({ error: 'Failed to save check-in' });
  }

  // Check for escalation triggers in issues
  if (issues && needsEscalation(issues)) {
    await db.from('escalations').insert({
      phone: client.phone,
      client_id,
      reason: 'checkin_keyword_trigger',
      message_body: issues,
    });

    try {
      await sendWhatsApp(
        process.env.MADDY_PHONE || '+917082478374',
        'escalation_alert',
        [maskPhone(client.phone), `Week ${week_no} check-in: ${issues.slice(0, 200)}`]
      );
    } catch (_) { /* best effort */ }
  }

  // Check for 2 consecutive missed check-ins (low compliance)
  if (compliance_score && parseInt(compliance_score) <= 3) {
    const { data: prevCheckins } = await db
      .from('checkins')
      .select('compliance_score')
      .eq('client_id', client_id)
      .lt('week_no', parseInt(week_no))
      .order('week_no', { ascending: false })
      .limit(1);

    if (prevCheckins && prevCheckins.length > 0 && prevCheckins[0].compliance_score <= 3) {
      await db.from('escalations').insert({
        phone: client.phone,
        client_id,
        reason: '2_consecutive_low_compliance',
        message_body: `Week ${week_no}: compliance=${compliance_score}, previous=${prevCheckins[0].compliance_score}`,
      });
    }
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
          'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
        },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
      });
    } catch (err) {
      console.error('Program gen trigger failed:', err.message);
    }
  }

  return res.status(200).json({ ok: true, checkin_id: checkin.id });
};
