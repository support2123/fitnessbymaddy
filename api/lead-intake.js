const { supabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, age, gender, goal, injuries,
      diet_pref, workout_days, equipment, medical_conditions,
      current_weight, target_weight, height
    } = req.body;

    if (!lead_id) {
      return res.status(400).json({ error: 'lead_id is required' });
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await supabase
      .from('leads')
      .update({
        name: name || lead.name,
        status: lead.status === 'new' ? 'qualified' : lead.status
      })
      .eq('id', lead_id);

    const intakeData = {
      name, email, age, gender, goal, injuries,
      diet_pref, workout_days, equipment, medical_conditions,
      current_weight, target_weight, height,
      submitted_at: new Date().toISOString()
    };

    const { error: storageError } = await supabase.storage
      .from('intake-forms')
      .upload(
        `${lead_id}.json`,
        JSON.stringify(intakeData, null, 2),
        { contentType: 'application/json', upsert: true }
      );

    if (storageError) {
      console.error('Storage upload error:', storageError.message);
    }

    const hasEscalation = [injuries, medical_conditions].some(
      field => field && /\b(injury|surgery|pregnant|medication|heart|diabetes)\b/i.test(field)
    );

    if (hasEscalation) {
      const { notifyMaddy } = require('./lib/whatsapp');
      await notifyMaddy(
        'Intake form — medical flag',
        `Lead ${name || lead_id}: ${(injuries || '') + ' ' + (medical_conditions || '')}`.slice(0, 200)
      );
    }

    return res.status(200).json({ success: true, lead_id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
