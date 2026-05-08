const { getSupabase } = require('../lib/supabase');
const { parseBody, handleCors } = require('../lib/helpers');
const { notifyMaddy } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = await parseBody(req);
  const {
    client_id,
    week_no,
    weight,
    waist,
    compliance_score,
    energy,
    issues,
    photos_urls
  } = body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no required' });
  }

  const db = getSupabase();

  // Verify client exists and is active
  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) {
    return res.status(404).json({ error: 'Client not found' });
  }

  if (client.status !== 'active') {
    return res.status(400).json({ error: 'Client is not active' });
  }

  // Check for duplicate submission
  const { data: existing } = await db
    .from('checkins')
    .select('id')
    .eq('client_id', client_id)
    .eq('week_no', parseInt(week_no))
    .limit(1);

  if (existing && existing.length > 0) {
    // Update existing check-in
    await db.from('checkins').update({
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photos_urls || [],
      form_submitted_at: new Date().toISOString()
    }).eq('id', existing[0].id);

    return res.status(200).json({ success: true, updated: true });
  }

  // Insert new check-in
  const { data: checkin, error } = await db.from('checkins').insert({
    client_id,
    week_no: parseInt(week_no),
    weight: weight ? parseFloat(weight) : null,
    waist: waist ? parseFloat(waist) : null,
    compliance_score: compliance_score ? parseInt(compliance_score) : null,
    energy: energy ? parseInt(energy) : null,
    issues: issues || null,
    photos_urls: photos_urls || []
  }).select().single();

  if (error) {
    return res.status(500).json({ error: 'Failed to save check-in' });
  }

  // Check for escalation signals in issues
  if (issues) {
    const { shouldEscalate } = require('../lib/helpers');
    const trigger = shouldEscalate(issues);
    if (trigger) {
      await notifyMaddy(trigger, client.phone, `Week ${week_no} check-in: ${issues}`);
    }
  }

  // Check for 2 consecutive missed (low compliance)
  if (compliance_score && parseInt(compliance_score) <= 3) {
    const { data: prevCheckins } = await db
      .from('checkins')
      .select('compliance_score')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    if (prevCheckins && prevCheckins.length >= 2) {
      const allLow = prevCheckins.every(c => c.compliance_score <= 3);
      if (allLow) {
        await notifyMaddy(
          '2 consecutive low compliance check-ins',
          client.phone,
          `Client ${client.name} has had 2+ weeks with compliance <= 3`
        );
      }
    }
  }

  // For 12-week clients, trigger program generation
  if (client.program === '12wk') {
    try {
      const baseUrl = `https://${req.headers.host || 'www.fitnessbymaddy.com'}`;
      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id })
      });
    } catch (err) {
      console.error('Failed to trigger program generation:', err.message);
    }
  }

  return res.status(200).json({ success: true, checkin_id: checkin.id });
};
