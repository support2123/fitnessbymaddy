// 2-hour outbound rate limit per lead (not applied to active clients or
// transactional sends marked with { force: true }).

import { getLastOutbound, getClientByPhone } from './supabase.js';

const TWO_HOURS = 2 * 60 * 60 * 1000;

export async function canSend({ phone, force = false }) {
  if (force) return true;
  const client = await getClientByPhone(phone);
  if (client) return true;
  const last = await getLastOutbound(phone, TWO_HOURS);
  return !last;
}
