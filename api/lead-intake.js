const { supabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, age, phone,
      goal, injuries, diet_pref, schedule,
      experience, equipment
    } = req.body;

    if (!lead_id) {
      return res.status(400).json({ error: 'Missing lead_id' });
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const updateData = {};
    if (name) updateData.name = name;

    if (Object.keys(updateData).length > 0) {
      await supabase.from('leads').update(updateData).eq('id', lead_id);
    }

    const intakeData = {
      lead_id, name, email, age, phone: phone || lead.phone,
      goal, injuries, diet_pref, schedule, experience, equipment,
      submitted_at: new Date().toISOString()
    };

    const { data: existing } = await supabase
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .limit(1);

    if (existing && existing.length > 0) {
      return res.json({ ok: true, message: 'Already onboarded', client_id: existing[0].id });
    }

    return res.json({
      ok: true,
      message: 'Intake received. Complete payment to begin your program.',
      lead_id,
      intake: intakeData
    });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
