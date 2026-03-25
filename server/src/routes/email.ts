import { Router, Request } from 'express';
import { Webhook } from 'svix';
import { Resend } from 'resend';
import rateLimit from 'express-rate-limit';
import prisma from '../lib/prisma';

const router = Router();
const resend = new Resend(process.env.RESEND_API_KEY);

// The subject prefix used in outgoing access-request notification emails (see auth.ts).
// Inbound replies are matched by looking for this exact string in the subject line.
const ACCESS_REQUEST_SUBJECT_PREFIX = '[Tunecraft] Spotify access request — ';

// Strips quoted reply lines (lines starting with ">") from an email body so that
// keyword matching operates only on the new content written by the admin — not
// on the quoted original message or any signature blocks that may contain words
// like "reject" in a job title or company name.
const stripQuotedLines = (text: string): string =>
  text
    .split('\n')
    .filter(line => !line.trimStart().startsWith('>'))
    .join('\n');

// Throttle webhook calls to 60 per minute per IP.
// Resend's infrastructure delivers webhooks from a small set of known IP ranges,
// so this limit is generous enough to never affect legitimate delivery while
// protecting against replay or flooding attacks.
const inboundRateLimit = rateLimit({
  windowMs:         60 * 1000, // 1 minute
  max:              60,
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: 'Too many requests' },
});

// POST /email/inbound
// Resend inbound-email webhook. Resend calls this endpoint whenever an email
// arrives at the domain configured under "Receiving" in the Resend dashboard.
//
// To set this up:
//   1. Add a receiving domain and routing rule in the Resend dashboard
//      (https://resend.com/inbound) pointing to <SERVER_URL>/email/inbound.
//   2. Copy the "Signing Secret" from that webhook and set RESEND_WEBHOOK_SECRET.
//   3. Set INBOUND_EMAIL_ADDRESS to the address you want to monitor (e.g. admin@tunecraft.app).
//
// The handler:
//   1. Verifies the Svix webhook signature — rejects tampered payloads.
//   2. Ignores events that are not 'email.received'.
//   3. Filters by the configured INBOUND_EMAIL_ADDRESS so only emails aimed at
//      the TuneCraft admin inbox are processed.
//   4. Fetches the full email body via resend.emails.receiving.get(email_id).
//   5. Matches the subject to the access-request notification pattern and
//      extracts the request ID embedded in the subject by auth.ts.
//   6. Reads APPROVED / REJECTED from the new-content portion of the body
//      (quoted reply lines are stripped to avoid false matches from signatures
//      or previously quoted text).
//   7. Updates SpotifyAccessRequest.status in the DB.
//   8. Sends a confirmation email to the requester.
router.post('/inbound', inboundRateLimit, async (req: Request, res) => {
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('RESEND_WEBHOOK_SECRET is not set — cannot verify inbound email webhooks');
    res.status(500).json({ error: 'Server configuration error' });
    return;
  }

  // Svix signature verification requires the exact raw bytes of the request body.
  // express.json() captures them via its verify callback into req.rawBody (see index.ts).
  const rawBody = req.rawBody;

  if (!rawBody) {
    res.status(400).json({ error: 'Empty request body' });
    return;
  }

  // Pull the three Svix signing headers that Resend attaches to every webhook call.
  const svixHeaders = {
    'svix-id':        req.headers['svix-id']        as string,
    'svix-timestamp': req.headers['svix-timestamp'] as string,
    'svix-signature': req.headers['svix-signature'] as string,
  };

  let event: { type: string; data: Record<string, unknown> };
  try {
    const wh = new Webhook(webhookSecret);
    // verify() throws if the signature is invalid or the timestamp is too old.
    event = wh.verify(rawBody, svixHeaders) as typeof event;
  } catch {
    res.status(401).json({ error: 'Invalid webhook signature' });
    return;
  }

  // We only care about inbound email events; acknowledge and exit for everything else.
  if (event.type !== 'email.received') {
    res.json({ received: true });
    return;
  }

  const payload = event.data as {
    email_id: string;
    to:       string[];
    from:     string;
    subject:  string;
  };

  // Filter by the configured inbound address so we only process emails sent to
  // the dedicated TuneCraft admin inbox. If INBOUND_EMAIL_ADDRESS is not set,
  // all received emails are processed (useful during local development / testing).
  const inboundAddress = process.env.INBOUND_EMAIL_ADDRESS?.toLowerCase();
  if (inboundAddress) {
    const addressed = payload.to.some(addr =>
      addr.toLowerCase() === inboundAddress ||
      addr.toLowerCase().includes(`<${inboundAddress}>`)
    );
    if (!addressed) {
      res.json({ received: true });
      return;
    }
  }

  // Match the subject to an access-request reply.
  // The outgoing notification subject is:
  //   "[Tunecraft] Spotify access request — <name> [<requestId>]"
  // When the admin replies, mail clients prepend "Re: " — we search for the
  // prefix anywhere in the subject to handle both original and replied subjects.
  const subject = (payload.subject ?? '').trim();
  const prefixIndex = subject.indexOf(ACCESS_REQUEST_SUBJECT_PREFIX);

  if (prefixIndex === -1) {
    // Not related to an access request — nothing to do.
    res.json({ received: true });
    return;
  }

  // Extract the request ID embedded between square brackets at the end of the subject.
  // Example tail: "John Doe [cm_abc123]" → requestId = "cm_abc123"
  const subjectTail = subject.slice(prefixIndex + ACCESS_REQUEST_SUBJECT_PREFIX.length);
  const idMatch = subjectTail.match(/\[([^\]]+)\]\s*$/);
  const requestId = idMatch?.[1] ?? null;

  if (!requestId) {
    // Subject doesn't contain a request ID — cannot reliably identify the request.
    res.json({ received: true });
    return;
  }

  // Fetch the full email body from the Resend API.
  // The webhook payload only carries metadata; the text/html body requires a
  // second call to GET /inbounds/{id}.
  let emailBody = '';
  try {
    const { data: fullEmail, error } = await resend.emails.receiving.get(payload.email_id);
    if (error || !fullEmail) {
      console.error('Failed to fetch inbound email body:', error);
      res.status(502).json({ error: 'Failed to retrieve email content' });
      return;
    }
    // Prefer plain text; fall back to HTML if the body isn't available in plain text.
    emailBody = fullEmail.text ?? fullEmail.html ?? '';
  } catch (fetchError) {
    console.error('Failed to fetch inbound email body:', fetchError);
    res.status(502).json({ error: 'Failed to retrieve email content' });
    return;
  }

  // Strip quoted reply lines ("> …") so keyword matching works on the admin's
  // new content only — not on the quoted original message or signatures that
  // might coincidentally contain words like "reject" or "approve".
  const newContent = stripQuotedLines(emailBody).toUpperCase();

  let newStatus: 'APPROVED' | 'REJECTED' | null = null;

  if (newContent.includes('APPROVED') || newContent.includes('APPROVE')) {
    newStatus = 'APPROVED';
  } else if (newContent.includes('REJECTED') || newContent.includes('REJECT')) {
    newStatus = 'REJECTED';
  }

  if (!newStatus) {
    // Body is ambiguous — acknowledge receipt but take no action.
    res.json({ received: true });
    return;
  }

  // Look up the request by its ID for an exact, collision-free match.
  const request = await prisma.spotifyAccessRequest.findFirst({
    where: { id: requestId, status: 'PENDING' },
  });

  if (!request) {
    // Already processed or ID didn't match any pending request.
    res.json({ received: true });
    return;
  }

  await prisma.spotifyAccessRequest.update({
    where: { id: request.id },
    data:  { status: newStatus },
  });

  // Send a confirmation email to the requester so they know the outcome.
  const userSubject = newStatus === 'APPROVED'
    ? '✅ Your Tunecraft access request was approved!'
    : '❌ Your Tunecraft access request was not approved';

  const userHtml = newStatus === 'APPROVED'
    ? `<p>Hi ${request.fullName},</p>
       <p>Great news — your Tunecraft Spotify access request has been <strong>approved</strong>!
       You can now log in at
       <a href="${process.env.FRONTEND_URL}/login">${process.env.FRONTEND_URL}/login</a>.</p>
       <p>Enjoy TuneCraft 🎛️</p>`
    : `<p>Hi ${request.fullName},</p>
       <p>Unfortunately your Tunecraft Spotify access request was
       <strong>not approved</strong> at this time.
       If you believe this is an error, please contact the admin directly.</p>`;

  try {
    await resend.emails.send({
      from:    'Tunecraft <onboarding@resend.dev>',
      to:      request.email,
      subject: userSubject,
      html:    userHtml,
    });
  } catch (emailError) {
    // Log but don't fail the webhook — the status was already updated in the DB.
    console.error('Failed to send access-request outcome email:', emailError);
  }

  console.log(
    `Access request ${newStatus.toLowerCase()} for ${request.fullName} (${request.email})`
  );
  res.json({ received: true });
});

export default router;

