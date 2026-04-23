const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id,
      name, email, phone, age, goal,
      injuries, diet_pref, schedule,
      experience, medical_conditions
    } = req.body;

    if (!lead_id) {
      return res.status(400).json({ error: 'Missing lead_id' });
    }

    const db = getSupabase();

    // Verify lead exists
    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .maybeSingle();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    // Update lead with name if provided
    if (name) {
      await db.from('leads').update({ name }).eq('id', lead_id);
    }

    // Check for medical escalation
    const { needsEscalation, escalateToMaddy } = require('../lib/escalation');
    const fullText = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    if (needsEscalation(fullText)) {
      await escalateToMaddy('Medical flag on intake form', phone || lead.phone, fullText);
    }

    // Store intake data on the lead (or pre-create client record)
    const intakeData = {
      lead_id,
      phone: phone || lead.phone,
      name: name || lead.name,
      email,
      program: lead.program_interest,
      age: age ? parseInt(age) : null,
      goal,
      injuries,
      diet_pref,
      schedule,
      status: 'active'
    };

    // Upsert client record (will be activated on payment)
    const { data: client, error } = await db
      .from('clients')
      .upsert(intakeData, { onConflict: 'lead_id' })
      .select()
      .single();

    if (error) {
      console.error('Intake save error:', error.message);
      return res.status(500).json({ error: 'Failed to save intake' });
    }

    return res.status(200).json({ success: true, client_id: client?.id });

  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
