const { supabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { needsEscalation, createEscalation } = require('./_lib/escalate');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no, weight, waist, compliance_score, energy, issues, photos_urls } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    // Verify client exists
    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .eq('status', 'active')
      .single();

    if (!client) return res.status(404).json({ error: 'Active client not found' });

    // Check for escalation keywords in issues
    if (needsEscalation(issues)) {
      await createEscalation(client.phone, 'checkin_issue', issues);
    }

    // Insert check-in
    const { error } = await supabase.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues,
      photos_urls: photos_urls || []
    });

    if (error) throw error;

    // Send confirmation
    await sendTemplate(client.phone, 'checkin_received', [
      client.name || 'there',
      String(week_no)
    ]);

    // If 12-week client, trigger program generation
    if (client.program === '12wk') {
      await triggerProgramGeneration(client_id, parseInt(week_no) + 1);
    }

    return res.status(200).json({ success: true, message: 'Check-in saved' });

  } catch (err) {
    console.error('Check-in error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function triggerProgramGeneration(clientId, nextWeek) {
  const baseUrl = process.env.APP_URL || 'https://fitnessbymaddy.com';
  try {
    await fetch(`${baseUrl}/api/generate-program`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
      },
      body: JSON.stringify({ client_id: clientId, week_no: nextWeek })
    });
  } catch (err) {
    console.error('Program generation trigger failed:', err.message);
  }
}
