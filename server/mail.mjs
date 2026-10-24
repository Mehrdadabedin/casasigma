/**
 * Outgoing email behind one `sendMail()`.
 *
 *   - With RESEND_API_KEY and MAIL_FROM set, mail goes through Resend's REST API
 *     (one `fetch`, no SDK):
 *       RESEND_API_KEY  key from https://resend.com/api-keys
 *       MAIL_FROM       a sender on a domain verified in Resend,
 *                       e.g. "CasaSigma <no-reply@example.com>"
 *   - Without them, outside production, each mail is written to a local outbox
 *     folder (`.mail-outbox/`, or MAIL_OUTBOX_DIR) as an .html and a .txt file.
 *   - In production without Resend nothing is sent.
 *
 * `sendMail` never throws and logs the kind of mail, never an address or text.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const OUTBOX_DEFAULT = join(dirname(fileURLToPath(import.meta.url)), '..', '.mail-outbox');

export function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function resendConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
}

async function sendWithResend({ to, subject, text, html }) {
  const response = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject, text, html }),
  });
  if (!response.ok) throw new Error(`resend answered ${response.status}`);
}

async function writeToOutbox({ kind, to, subject, text, html }) {
  const dir = process.env.MAIL_OUTBOX_DIR || OUTBOX_DEFAULT;
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').replace('Z', '');
  let base = `${stamp}-${kind}`;
  for (let n = 2; ; n += 1) {
    try {
      await writeFile(join(dir, `${base}.html`), `<!-- To: ${esc(to)} | Subject: ${esc(subject)} -->\n${html}`, { flag: 'wx' });
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      base = `${stamp}-${kind}-${n}`;
    }
  }
  await writeFile(join(dir, `${base}.txt`), `To: ${to}\nSubject: ${subject}\n\n${text}\n`);
  return `${base}.html`;
}

export async function sendMail(mail) {
  try {
    if (resendConfigured()) {
      await sendWithResend(mail);
      console.log(`mail sent (${mail.kind})`);
    } else if (process.env.NODE_ENV !== 'production') {
      console.log(`mail written to the outbox: ${await writeToOutbox(mail)}`);
    } else {
      console.log(`mail skipped (${mail.kind})`);
    }
  } catch (error) {
    console.error(`mail failed (${mail.kind}): ${error.name}`);
  }
}

function layout({ heading, bodyHtml }) {
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:32px 16px;background:#f8f4ed;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#221d18;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:520px;margin:0 auto;background:#fffdf8;border:1px solid #e5dac9;border-radius:18px;">
      <tr>
        <td style="padding:28px 28px 8px;">
          <p style="margin:0 0 6px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#8f3722;font-weight:700;">CasaSigma</p>
          <h1 style="margin:0 0 14px;font-family:Georgia,'Iowan Old Style',serif;font-size:24px;line-height:1.2;">${esc(heading)}</h1>
          ${bodyHtml}
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

const p = (html) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#4b423a;">${html}</p>`;
const button = (href, label) =>
  `<p style="margin:0 0 22px;"><a href="${esc(href)}" style="display:inline-block;padding:13px 22px;background:#221d18;color:#fffdf8;border-radius:999px;font-size:15px;font-weight:600;text-decoration:none;">${esc(label)}</a></p>`;

export function passwordResetMail({ name, resetUrl }) {
  const greeting = name ? `Hello ${name},` : 'Hello,';
  const text = [
    greeting,
    '',
    'Someone asked to reset the password for your CasaSigma account.',
    'Choose a new one here. The link works once and expires in an hour:',
    '',
    resetUrl,
    '',
    'If this was not you, ignore this email: nothing changes until the link is used.',
    '',
    'CasaSigma',
  ].join('\n');
  const html = layout({
    heading: 'Choose a new password',
    bodyHtml:
      p(esc(greeting)) +
      p('Someone asked to reset the password for your CasaSigma account. The link works once and expires in an hour.') +
      button(resetUrl, 'Choose a new password') +
      p(`If the button does not work, paste this address into your browser:<br /><span style="color:#8f3722;word-break:break-all;">${esc(resetUrl)}</span>`) +
      p('If this was not you, ignore this email. Nothing changes until the link is used.'),
  });
  return { kind: 'password-reset', subject: 'Choose a new CasaSigma password', text, html };
}

function when(request) {
  return `${request.date} at ${request.time}`;
}

/** To the seller: who wants to see which listing, and when. */
export function viewingSellerMail({ request, dashboardUrl }) {
  const text = [
    'You have a new viewing request on CasaSigma.',
    '',
    `Listing: ${request.listingTitle}`,
    `When: ${when(request)}`,
    `Visitor: ${request.name} <${request.email}>`,
    request.description ? `Message: ${request.description}` : '',
    '',
    `Confirm or decline it in your dashboard: ${dashboardUrl}`,
  ]
    .filter((line, index, all) => line !== '' || all[index - 1] !== '')
    .join('\n');
  const html = layout({
    heading: 'New viewing request',
    bodyHtml:
      p(`<strong>${esc(request.name)}</strong> would like to see <strong>${esc(request.listingTitle)}</strong>.`) +
      p(`When: ${esc(when(request))}<br />Email: ${esc(request.email)}`) +
      (request.description ? p(`Message: ${esc(request.description)}`) : '') +
      button(dashboardUrl, 'Open your dashboard'),
  });
  return { kind: 'viewing-seller', subject: `Viewing request: ${request.listingTitle}`, text, html };
}

/** To the visitor: proof that the request went out. */
export function viewingVisitorMail({ request }) {
  const text = [
    `Hello ${request.name},`,
    '',
    `We received your request to see ${request.listingTitle} on ${when(request)}.`,
    'You will hear from the seller or the team to confirm the visit.',
    '',
    'CasaSigma',
  ].join('\n');
  const html = layout({
    heading: 'We received your request',
    bodyHtml:
      p(`Hello ${esc(request.name)},`) +
      p(`We received your request to see <strong>${esc(request.listingTitle)}</strong> on ${esc(when(request))}.`) +
      p('You will hear from the seller or the team to confirm the visit.'),
  });
  return { kind: 'viewing-visitor', subject: `Your viewing request: ${request.listingTitle}`, text, html };
}
