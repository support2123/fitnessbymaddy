// Internal helper endpoint — POST { to, body?, campaignName?, templateParams?, userName?, bypassRateLimit? }
// Protected by X-Internal-Key header so only trusted callers (cron, other /api fns, admin) can use it.

const { sendText } = require('./_lib/aisensy');
const { readJson, ok, err, assertMethod } = require('./_lib/utils');

module.exports = async (req, res) => {
  if (!assertMethod(req, res, ['POST'])) return;

  const internalKey = process.env.SUPABASE_SERVICE_KEY || '';
  const provided = req.headers['x-internal-key'];
  if (!provided || provided !== internalKey) {
    return err(res, 401, 'unauthorized');
  }

  const body = await readJson(req);
  if (!body.to) return err(res, 400, 'missing_to');

  const result = await sendText({
    to: body.to,
    body: body.body,
    campaignName: body.campaignName,
    userName: body.userName,
    templateParams: body.templateParams || [],
    media: body.media || null,
    bypassRateLimit: !!body.bypassRateLimit,
  });

  return ok(res, result);
};
