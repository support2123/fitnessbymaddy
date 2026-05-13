const { supabase } = require('../lib/supabase');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');
const { maskPhone } = require('../lib/whatsapp');
const { cors } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, phone, age, gender, height, weight,
      goal, injuries, diet_pref, schedule, medical_conditions,
      experience_level, photos
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const intakeText = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    if (needsEscalation(intakeText)) {
      await escalateToMaddy(
        'Medical flag on intake form',
        `Lead ${maskPhone(phone)}: injuries="${injuries}", medical="${medical_conditions}"`
      );
    }

    const updates = {};
    if (name) updates.name = name;
    if (email) updates.email = email;

    if (Object.keys(updates).length) {
      await supabase.from('leads').update(updates).eq('id', lead_id);
    }

    const { error } = await supabase.from('lead_intake').upsert({
      lead_id, name, email, phone, age, gender, height, weight,
      goal, injuries, diet_pref, schedule, medical_conditions,
      experience_level, photos: photos || [],
      submitted_at: new Date().toISOString()
    }, { onConflict: 'lead_id' });

    if (error) {
      // Table might not exist yet - create inline
      if (error.code === '42P01') {
        await supabase.rpc('exec_sql', {
          sql: `CREATE TABLE IF NOT EXISTS lead_intake (
            id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
            lead_id uuid REFERENCES leads(id) UNIQUE,
            name text, email text, phone text, age integer,
            gender text, height numeric, weight numeric,
            goal text, injuries text, diet_pref text,
            schedule text, medical_conditions text,
            experience_level text, photos text[] DEFAULT '{}',
            submitted_at timestamptz DEFAULT now()
          )`
        });
        await supabase.from('lead_intake').upsert({
          lead_id, name, email, phone, age, gender, height, weight,
          goal, injuries, diet_pref, schedule, medical_conditions,
          experience_level, photos: photos || [],
          submitted_at: new Date().toISOString()
        }, { onConflict: 'lead_id' });
      } else {
        throw error;
      }
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
