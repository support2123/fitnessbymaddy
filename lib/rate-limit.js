// Rate-limiter: max 1 outbound message per lead per 2 hours.
// Active clients (clients.status='active') bypass this limit.
// Dropped / opt-out leads are always blocked.

import { db } from './supabase.js';

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

export async function canSend(phone) {
  const sb = db();

  // Hard block: dropped lead (covers opt-out).
  const { data: lead } = await sb
    .from('leads')
    .select('status')
    .eq('phone', phone)
    .maybeSingle();
  if (lead?.status === 'dropped') {
    return { allowed: false, reason: 'opted_out' };
  }

  // Active client → unlimited transactional.
  const { data: client } = await sb
    .from('clients')
    .select('status')
    .eq('phone', phone)
    .maybeSingle();
  if (client?.status === 'active') {
    return { allowed: true, reason: 'active_client' };
  }

  // Otherwise enforce 2-hour cooldown.
  const cutoff = new Date(Date.now() - TWO_HOURS_MS).toISOString();
  const { data: recent } = await sb
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', cutoff)
    .limit(1);
  if (recent && recent.length > 0) {
    return { allowed: false, reason: 'cooldown_2h' };
  }
  return { allowed: true, reason: 'ok' };
}

export async function recordSend(_phone) {
  // No-op: logMessage() writes the row that canSend() reads.
  return;
}
