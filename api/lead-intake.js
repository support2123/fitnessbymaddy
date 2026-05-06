const { getSupabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, age, gender, height, weight,
      goal, injuries, diet_pref, schedule, experience,
      medical_conditions, phone
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone is required' });
    }

    const db = getSupabase();

    let leadId = lead_id;
    if (!leadId && phone) {
      const { data: lead } = await db
        .from('leads')
        .select('id')
        .eq('phone', phone)
        .limit(1)
        .single();
      if (lead) leadId = lead.id;
    }

    if (leadId) {
      await db
        .from('leads')
        .update({
          name: name || undefined,
          last_msg_at: new Date().toISOString()
        })
        .eq('id', leadId);
    }

    const intakeData = {
      lead_id: leadId,
      name, email, age, gender, height, weight,
      goal, injuries, diet_pref, schedule, experience,
      medical_conditions, submitted_at: new Date().toISOString()
    };

    const { error } = await db.from('intake_forms').upsert(intakeData, {
      onConflict: 'lead_id'
    });

    if (error) {
      const { error: createErr } = await db.rpc('create_intake_if_missing');
      if (!createErr) {
        await db.from('intake_forms').insert(intakeData);
      }
    }

    return res.status(200).json({ success: true, message: 'Intake form submitted' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
