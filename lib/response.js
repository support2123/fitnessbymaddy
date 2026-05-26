function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function error(message, status = 400) {
  return json({ error: message }, status);
}

function ok(data) {
  return json({ ok: true, ...data });
}

module.exports = { json, error, ok };
