const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

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
      current_weight,
      target_weight,
      experience_level,
      medical_conditions,
    } = req.body;

    if (!lead_id) {
      return res.status(400).json({ error: 'lead_id is required' });
    }

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('id, phone, status')
      .eq('id', lead_id)
      .single();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await db.from('leads').update({
      name: name || undefined,
    }).eq('id', lead_id);

    const { error } = await db.from('clients').upsert({
      lead_id,
      phone: phone || lead.phone,
      name,
      email,
      program: '12wk',
      status: 'active',
      paid_amount: 0,
    }, { onConflict: 'lead_id', ignoreDuplicates: true });

    if (error && !error.message.includes('duplicate')) {
      console.error('Intake insert error:', error.message);
    }

    return res.status(200).json({
      success: true,
      message: 'Intake form received. We\'ll be in touch shortly!',
    });
  } catch (err) {
    console.error('Lead intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
