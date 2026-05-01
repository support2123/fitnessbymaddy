const { getSupabase } = require('./lib/supabase');
const { maskPhone, jsonResponse, cors } = require('./lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { cors(res); return res.status(200).end(); }
  if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'Method not allowed' });

  const supabase = getSupabase();
  const data = req.body;

  const { client_id, week_no, weight, waist, compliance_score, energy, issues } = data;

  if (!client_id || !week_no) {
    return jsonResponse(res, 400, { error: 'Missing client ID or week number.' });
  }

  const { data: client, error: clientErr } = await supabase
    .from('clients')
    .select('id, phone, name, program')
    .eq('id', client_id)
    .single();

  if (clientErr || !client) {
    return jsonResponse(res, 404, { error: 'Client not found.' });
  }

  const { data: existing } = await supabase
    .from('checkins')
    .select('id')
    .eq('client_id', client_id)
    .eq('week_no', parseInt(week_no))
    .single();

  if (existing) {
    await supabase.from('checkins').update({
      weight: parseFloat(weight) || null,
      waist: parseFloat(waist) || null,
      compliance_score: parseInt(compliance_score) || null,
      energy: parseInt(energy) || null,
      issues,
      form_submitted_at: new Date().toISOString(),
    }).eq('id', existing.id);
  } else {
    await supabase.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      weight: parseFloat(weight) || null,
      waist: parseFloat(waist) || null,
      compliance_score: parseInt(compliance_score) || null,
      energy: parseInt(energy) || null,
      issues,
    });
  }

  const escalationWords = ['pain', 'dizzy', 'dizziness', 'faint', 'nausea', 'eating disorder', 'binge', 'purge'];
  const issueText = (issues || '').toLowerCase();
  const needsEscalation = escalationWords.some(w => issueText.includes(w));

  if (needsEscalation) {
    const { sendWhatsApp } = require('./send-whatsapp');
    await sendWhatsApp({
      phone: '+' + (process.env.MADDY_PHONE || '917082478374'),
      templateName: 'escalation_alert',
      bodyValues: [client.name || 'Client', `Week ${week_no} check-in flag: ${issues.substring(0, 200)}`],
      isClient: true,
    });
  }

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
    } catch (e) {
      console.error('Program generation trigger failed:', e.message);
    }
  }

  console.log(`Check-in: client=${client_id} week=${week_no}`);
  return jsonResponse(res, 200, { success: true });
};
