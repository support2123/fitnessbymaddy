const { supabase } = require('./lib/supabase');
const { needsEscalation, notifyMaddy, maskPhone } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;
    const {
      client_id, week_no, token,
      weight, waist, compliance_score, energy,
      issues, photos_urls
    } = body;

    if (!token) {
      return res.status(400).json({ error: 'Token required' });
    }

    const { data: existing } = await supabase
      .from('checkins')
      .select('*')
      .eq('token', token)
      .single();

    if (!existing) {
      return res.status(404).json({ error: 'Invalid or expired check-in token' });
    }

    if (existing.form_submitted_at && existing.weight) {
      return res.status(409).json({ error: 'Check-in already submitted' });
    }

    const { error } = await supabase
      .from('checkins')
      .update({
        weight: weight || null,
        waist: waist || null,
        compliance_score: compliance_score || null,
        energy: energy || null,
        issues: issues || null,
        photos_urls: photos_urls || [],
        form_submitted_at: new Date().toISOString()
      })
      .eq('token', token);

    if (error) {
      console.error('Checkin update error:', error.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    if (issues && needsEscalation(issues)) {
      const { data: client } = await supabase
        .from('clients')
        .select('phone, name')
        .eq('id', existing.client_id)
        .single();

      await notifyMaddy(
        'Client health concern',
        `${client?.name || 'Client'} (${maskPhone(client?.phone)}) week ${week_no}: "${issues.slice(0, 120)}"`
      );
    }

    const { data: client } = await supabase
      .from('clients')
      .select('program')
      .eq('id', existing.client_id)
      .single();

    let triggerProgram = false;
    if (client && client.program === '12wk') {
      triggerProgram = true;
    }

    return res.status(200).json({
      ok: true,
      message: 'Check-in submitted successfully',
      trigger_program_generation: triggerProgram
    });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
