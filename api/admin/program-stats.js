const supabase = require('../../lib/supabase');
const { PROGRAM_NAMES } = require('../../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.ADMIN_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: clients } = await supabase
      .from('clients')
      .select('program')
      .eq('status', 'active');

    const counts = {};
    for (const c of (clients || [])) {
      const prog = c.program || 'unknown';
      counts[prog] = (counts[prog] || 0) + 1;
    }

    const result = Object.entries(counts)
      .map(([program, count]) => ({
        program: PROGRAM_NAMES[program] || program,
        count
      }))
      .sort((a, b) => b.count - a.count);

    return res.status(200).json(result);
  } catch (err) {
    console.error('[Admin/ProgramStats]', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
