const { getSupabase } = require('./_lib/supabase');
const { handleCors } = require('./_lib/cors');

function maskPhone(phone) {
  if (!phone || phone.length < 4) return '***';
  return '***' + phone.slice(-3);
}

// Map program interest to duration in weeks
const PROGRAM_DURATIONS = {
  '6wk_gym': 6,
  'pcos': 8,
  '40plus': 8,
  '12wk': 12,
  'zoom_trial': 1,
  'zoom_pack': 4,
};

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabase = getSupabase();

  try {
    const {
      lead_id,
      name,
      email,
      age,
      goal,
      injuries,
      diet_pref,
      schedule,
      phone,
    } = req.body || {};

    // Validate required fields
    if (!lead_id || !name || !phone) {
      return res.status(400).json({
        error: 'Missing required fields: lead_id, name, phone',
      });
    }

    // Update lead record with name
    const { data: lead, error: leadErr } = await supabase
      .from('leads')
      .update({ name })
      .eq('id', lead_id)
      .select('id, program_interest')
      .single();

    if (leadErr) {
      console.error(`Lead update error for ${maskPhone(phone)}:`, leadErr.message);
      return res.status(404).json({ error: 'Lead not found' });
    }

    // Check if client already exists for this lead
    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .maybeSingle();

    if (existingClient) {
      return res.status(200).json({
        success: true,
        client_id: existingClient.id,
        message: 'Client already exists',
      });
    }

    // Calculate program dates
    const program = lead.program_interest || null;
    const programStartedAt = new Date().toISOString();
    let programEndsAt = null;

    if (program && PROGRAM_DURATIONS[program]) {
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + PROGRAM_DURATIONS[program] * 7);
      programEndsAt = endDate.toISOString();
    }

    // Create client record
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .insert({
        lead_id,
        phone,
        name,
        email: email || null,
        program,
        program_started_at: programStartedAt,
        program_ends_at: programEndsAt,
        status: 'active',
        age: age || null,
        goal: goal || null,
        injuries: injuries || null,
        diet_pref: diet_pref || null,
        schedule: schedule || null,
      })
      .select('id')
      .single();

    if (clientErr) {
      console.error(`Client create error for ${maskPhone(phone)}:`, clientErr.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    return res.status(201).json({
      success: true,
      client_id: client.id,
    });
  } catch (err) {
    const phone = req.body?.phone;
    console.error(`Lead intake error for ${maskPhone(phone)}:`, err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
