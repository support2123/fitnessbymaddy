const { getClient } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.fitnessbymaddy.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_preference, schedule,
      medical_conditions, current_weight, height,
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    const db = getClient();

    let lead;
    if (lead_id) {
      const { data } = await db.from('leads').select('*').eq('id', lead_id).single();
      lead = data;
    } else if (phone) {
      const { data } = await db.from('leads').select('*').eq('phone', phone).single();
      lead = data;
    }

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    if (name) {
      await db.from('leads').update({ name }).eq('id', lead.id);
    }

    const intakeData = {
      lead_id: lead.id,
      name: name || lead.name,
      email,
      phone: lead.phone,
      age: age ? parseInt(age) : null,
      gender,
      goal,
      injuries: injuries || null,
      diet_preference: diet_preference || null,
      schedule: schedule || null,
      medical_conditions: medical_conditions || null,
      current_weight: current_weight ? parseFloat(current_weight) : null,
      height: height ? parseFloat(height) : null,
      submitted_at: new Date().toISOString(),
    };

    const { error } = await db.from('intake_forms').upsert(intakeData, { onConflict: 'lead_id' });

    if (error) {
      if (error.code === '42P01') {
        await db.rpc('exec_sql', {
          sql: `CREATE TABLE IF NOT EXISTS intake_forms (
            id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
            lead_id UUID UNIQUE REFERENCES leads(id),
            name TEXT, email TEXT, phone TEXT,
            age INTEGER, gender TEXT, goal TEXT,
            injuries TEXT, diet_preference TEXT, schedule TEXT,
            medical_conditions TEXT, current_weight NUMERIC, height NUMERIC,
            submitted_at TIMESTAMPTZ DEFAULT now()
          )`
        });
        await db.from('intake_forms').upsert(intakeData, { onConflict: 'lead_id' });
      } else {
        throw error;
      }
    }

    return res.status(200).json({ ok: true, message: 'Intake form submitted successfully' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
