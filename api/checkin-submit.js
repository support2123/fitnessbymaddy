const { getSupabase } = require('./_lib/supabase');
const { needsEscalation, createEscalation } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabase();
  const data = req.body;

  const clientId = data.client_id;
  const weekNo = parseInt(data.week_no);

  if (!clientId || !weekNo) {
    return res.status(400).json({ error: 'client_id and week_no are required' });
  }

  // Verify client exists
  const { data: client } = await supabase
    .from('clients')
    .select('id, phone, program')
    .eq('id', clientId)
    .single();

  if (!client) {
    return res.status(404).json({ error: 'Client not found' });
  }

  // Check for escalation triggers in issues
  if (data.issues) {
    const escalationReason = needsEscalation(data.issues);
    if (escalationReason) {
      await createEscalation({
        phone: client.phone,
        clientId,
        reason: `Check-in week ${weekNo}: ${escalationReason}`,
        triggerMessage: data.issues
      });
    }
  }

  // Handle photo URLs (uploaded via Supabase Storage from frontend)
  const photosUrls = data.photos_urls || [];

  const { error } = await supabase.from('checkins').upsert({
    client_id: clientId,
    week_no: weekNo,
    weight: data.weight ? parseFloat(data.weight) : null,
    waist: data.waist ? parseFloat(data.waist) : null,
    compliance_score: data.compliance_score ? parseInt(data.compliance_score) : null,
    energy: data.energy ? parseInt(data.energy) : null,
    issues: data.issues || null,
    photos_urls: photosUrls,
    form_submitted_at: new Date().toISOString()
  }, { onConflict: 'client_id,week_no' });

  if (error) {
    console.error('Checkin insert error:', error.message);
    return res.status(500).json({ error: 'Failed to save check-in' });
  }

  // Trigger program generation for 12-week clients
  if (client.program === '12wk') {
    try {
      const baseUrl = `https://${req.headers.host}`;
      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
        },
        body: JSON.stringify({ client_id: clientId, week_no: weekNo + 1 })
      });
    } catch (err) {
      console.error('Program generation trigger failed:', err.message);
    }
  }

  return res.status(200).json({ success: true, message: 'Check-in submitted' });
};
