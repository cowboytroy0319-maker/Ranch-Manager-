# Password-reset email configuration (missing — no provider configured)

There is NO email sender in the codebase today: no mail provider SDK in
`package.json`, no mail env vars anywhere. The reset flow is fully built
(token system + `/forgot-password` + `/reset-password` UI), and the send path
is structured (`buildPasswordResetEmail` + `sendPasswordResetEmail` in
`src/server/passwordResetServer.ts`) so a provider can plug in — but until
the owner configures one, `sendPasswordResetEmail` logs the send intent
server-side only (address + expiry, never the token) and delivers nothing.
No reset email is ever sent to anyone from any environment today.

## What to set (env var NAMES only — values stay in the deploy dashboard)

Pick ONE provider and set its vars on the deployment (never commit values):

- Resend: `RESEND_API_KEY`, `RESET_EMAIL_FROM`
- SendGrid: `SENDGRID_API_KEY`, `RESET_EMAIL_FROM`
- Postmark: `POSTMARK_SERVER_TOKEN`, `RESET_EMAIL_FROM`
- Generic SMTP: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `RESET_EMAIL_FROM`

`RESET_EMAIL_FROM` is the verified sender identity (e.g.
`Ranch Manager Pro <noreply@ranchmanagerpro.com>`) — every provider needs it.
Implement `sendPasswordResetEmail` with the chosen SDK, keep its exact
signature `(email: ResetEmail) => Promise<{ delivered: boolean }>`, and keep
logging only address + expiry server-side (never the token or link).

## Local / preview testing WITHOUT a provider (never sends to real users)

1. Set `RMP_RESET_TEST_MODE=1` on the LOCAL or PREVIEW deployment only.
   Never set it where real users exist; it is hard-blocked when
   `APP_ENV=production` (`isResetTestMode()` returns false there, and the
   public `requestPasswordReset` server fn never forwards any token).
2. Submit `/forgot-password` with the test account's email.
3. Read the raw token from the SERVER LOGS (`[password-reset] test-mode
   token issued for …`) — it is also returned as `testOnly` by the
   injectable `requestPasswordResetCore` (unit-test path only, never the
   public server fn).
4. Open `/reset-password?token=<token>`, enter the same account email + the
   new password twice, submit. Success deletes all sessions (re-login) and
   shows the success message with a link to `/login`.
5. Tokens expire after 45 minutes, work exactly once, and a newer request
   supersedes older ones — replays fail with the generic invalid message.

## Safe-email-sender status

Exists: NO. Missing config: one provider credential set from the list above
(`RESEND_API_KEY` or `SENDGRID_API_KEY` or `POSTMARK_SERVER_TOKEN` or the
`SMTP_*` set) plus `RESET_EMAIL_FROM`.
