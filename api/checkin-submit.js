const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { corsHeaders, parseBody } = require('./_lib/utils');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = await parseBody(req);
  const {
    client_id, week_no, weight, waist,
    compliance_score, energy, issues, photos_urls
  } = body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no required' });
  }

  const db = getSupabase();

  const client = await db.from('clients').select('*').eq('id', client_id).single();
  if (!client.data) {
    return res.status(404).json({ error: 'Client not found' });
  }

  const { data: checkin, error } = await db.from('checkins').upsert({
    client_id,
    week_no: parseInt(week_no),
    weight: weight ? parseFloat(weight) : null,
    waist: waist ? parseFloat(waist) : null,
    compliance_score: compliance_score ? parseInt(compliance_score) : null,
    energy: energy ? parseInt(energy) : null,
    issues: issues || null,
    photos_urls: photos_urls || [],
    form_submitted_at: new Date().toISOString()
  }, { onConflict: 'client_id,week_no' }).select().single();

  if (error) {
    return res.status(500).json({ error: 'Failed to save check-in' });
  }

  const ack = `Check-in received for Week ${week_no}! \u{1F4AA}\nWeight: ${weight || 'N/A'}kg | Compliance: ${compliance_score || 'N/A'}/10\n\nYour updated program will be sent shortly.`;
  await sendWhatsApp(client.data.phone, ack, 'checkin_ack');

  if (client.data.program === '12wk') {
    try {
      const origin = `https://${req.headers.host}`;
      await fetch(`${origin}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
        },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
      });
    } catch (_) {
      // program generation runs async — failures handled in that endpoint
    }
  }

  return res.status(200).json({ success: true, checkin_id: checkin?.id });
};
