const { getSupabase } = require('../lib/supabase');

/**
 * Masks a phone number for safe logging.
 */
function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, -4).replace(/.(?=.{4})/g, '*').slice(0, -4) + phone.slice(-4);
}

const REQUIRED_FIELDS = ['name', 'email', 'phone', 'age', 'goal', 'diet_preference'];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const data = req.body || {};

    /* ── Validate required fields ── */
    const missing = REQUIRED_FIELDS.filter((f) => !data[f]);
    if (missing.length > 0) {
      return res
        .status(400)
        .json({ error: `Missing required fields: ${missing.join(', ')}` });
    }

    const phone = data.phone.replace(/\s+/g, '');
    const supabase = getSupabase();

    /* ── Build intake JSON blob (all submitted fields) ── */
    const intakeData = { ...data };
    delete intakeData.phone; // phone is the top-level key, no need to duplicate

    /* ── Upsert lead — match on phone ── */
    const { error } = await supabase
      .from('leads')
      .upsert(
        {
          phone,
          name: data.name,
          email: data.email,
          age: parseInt(data.age, 10) || null,
          goal: data.goal,
          diet_preference: data.diet_preference,
          intake_data: intakeData,
          intake_submitted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'phone' }
      );

    if (error) {
      console.error(`lead-intake upsert error [${maskPhone(phone)}]:`, error.message);
      return res.status(500).json({ error: 'Failed to save intake data' });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    const safePhone = maskPhone((req.body || {}).phone || '');
    console.error(`lead-intake error [${safePhone}]:`, err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
