import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default supabase;

export async function ensureTablesExist() {
  const tables = ['leads', 'clients', 'checkins', 'programs', 'messages'];
  const { data } = await supabase
    .from('leads')
    .select('id')
    .limit(1)
    .maybeSingle();
  return true;
}
