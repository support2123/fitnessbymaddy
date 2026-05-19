const { supabase } = require('./_lib/supabase');
const { maskPhone } = require('./_lib/pii');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      lead_id,
      name,
      email,
      phone,
      age,
      gender,
      goal,
      injuries,
      diet_preference,
      schedule,
      experience,
      current_weight,
      target_weight,
      medical_conditions,
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    let lead;
    if (lead_id) {
      const { data } = await supabase.from('leads').select('*').eq('id', lead_id).single();
      lead = data;
    } else {
      const { data } = await supabase
        .from('leads')
        .select('*')
        .eq('phone', phone)
        .order('created_at', { ascending: false })
        .limit(1);
      lead = data?.[0];
    }

    if (!lead) {
      const { data: newLead } = await supabase
        .from('leads')
        .insert({ phone, name, source: 'intake_form', status: 'new' })
        .select()
        .single();
      lead = newLead;
    }

    await supabase
      .from('leads')
      .update({
        name: name || lead.name,
        program_interest: goal || lead.program_interest,
      })
      .eq('id', lead.id);

    // Store intake data as a note on the lead for now
    // In production, you'd have an intake_data jsonb column
    console.log(`[Intake] Form submitted for ${maskPhone(lead.phone)}: age=${age}, goal=${goal}`);

    return res.status(200).json({
      success: true,
      message: 'Intake form received! We\'ll be in touch soon.',
      lead_id: lead.id,
    });
  } catch (error) {
    console.error('[Intake Error]', error.message);
    return res.status(500).json({ error: 'Failed to process intake form' });
  }
};
