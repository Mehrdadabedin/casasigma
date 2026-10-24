/**
 * Transactional email over Resend's REST API.
 *
 * The server is plain Node with no SDK dependencies, so this is one `fetch`
 * against https://api.resend.com/emails. Configure it with:
 *
 *   RESEND_API_KEY  — key from https://resend.com/api-keys
 *   MAIL_FROM       — a sender on a domain verified in Resend, e.g.
 *                     "CasaSigma <no-reply@casasigma.com>"
 *
 * Without both, `mailConfigured()` is false and the caller logs the reset link
 * to the server console instead of failing the request.
 */
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export function mailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
}

function resetBody({ name, resetUrl }) {
  const greeting = name ? `Hello ${name},` : 'Hello,';
  const text = [
    greeting,
    '',
    'Someone asked to reset the password for your CasaSigma account.',
    'Choose a new one here — the link works once and expires in an hour:',
    '',
    resetUrl,
    '',
    'If this was not you, ignore this email: nothing changes until the link is used.',
    '',
    '— CasaSigma',
  ].join('\n');

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:32px 16px;background:#f8f4ed;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#221d18;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:520px;margin:0 auto;background:#fffdf8;border:1px solid #e5dac9;border-radius:18px;">
      <tr>
        <td style="padding:28px 28px 8px;">
          <p style="margin:0 0 6px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#8f3722;font-weight:700;">CasaSigma</p>
          <h1 style="margin:0 0 14px;font-family:Georgia,'Iowan Old Style',serif;font-size:24px;line-height:1.2;">Choose a new password</h1>
          <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#4b423a;">${greeting}</p>
          <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#4b423a;">
            Someone asked to reset the password for your CasaSigma account. The link works once and
            expires in an hour.
          </p>
          <p style="margin:0 0 22px;">
            <a href="${resetUrl}" style="display:inline-block;padding:13px 22px;background:#221d18;color:#fffdf8;border-radius:999px;font-size:15px;font-weight:600;text-decoration:none;">Choose a new password</a>
          </p>
          <p style="margin:0 0 18px;font-size:13px;line-height:1.6;color:#7c7165;">
            If the button does not work, paste this address into your browser:<br />
            <span style="color:#8f3722;word-break:break-all;">${resetUrl}</span>
          </p>
          <p style="margin:0 0 24px;font-size:13px;line-height:1.6;color:#7c7165;">
            If this was not you, ignore this email — nothing changes until the link is used.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { text, html };
}

/** Throws with a short message when Resend rejects the send. */
export async function sendPasswordResetEmail({ to, name, resetUrl }) {
  const { text, html } = resetBody({ name, resetUrl });
  const response = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.MAIL_FROM,
      to: [to],
      subject: 'Choose a new CasaSigma password',
      text,
      html,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`resend ${response.status}: ${detail.slice(0, 300)}`);
  }
}
