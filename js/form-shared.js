// Small shared helpers for the public forms.
// No framework — we keep everything vanilla per brand guidelines.

export const $ = (sel, ctx = document) => ctx.querySelector(sel);
export const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

// Read ?lead=… / ?c=… / ?t=… off the URL.
export function qp(name) {
  return new URL(location.href).searchParams.get(name);
}

// Supabase storage upload direct from the browser.
// Public anon key + a per-form signed upload URL would be more secure;
// for MVP we use the anon key with a bucket that has a policy allowing
// INSERT to the `client-photos` prefix only.
export async function uploadToSupabase(file, { bucket, path, supabaseUrl, anonKey }) {
  const url = `${supabaseUrl}/storage/v1/object/${bucket}/${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${anonKey}`,
      apikey: anonKey,
      'Content-Type': file.type || 'application/octet-stream',
      'x-upsert': 'true',
    },
    body: file,
  });
  if (!res.ok) throw new Error(`upload_failed_${res.status}`);
  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${path}`;
}

// Turn a slot <input type="file"> into a thumbnail-preview tile.
export function wireFileSlot(slotEl, onChange) {
  const input = slotEl.querySelector('input');
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = e => {
      slotEl.innerHTML = `<img src="${e.target.result}" alt="">` + slotEl.querySelector('input').outerHTML;
      slotEl.classList.add('filled');
      onChange?.(f);
    };
    reader.readAsDataURL(f);
  });
}

// Live slider value readout.
export function wireSlider(rangeEl, valEl) {
  const sync = () => { valEl.textContent = rangeEl.value; };
  rangeEl.addEventListener('input', sync);
  sync();
}

export function postJson(url, body) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(async r => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `http_${r.status}`);
    return data;
  });
}
