# Supabase Email Templates — The Buzz Guide

Supabase sends auth emails (signup confirmation, password reset, magic link, email change) using its own templating engine — **separate from the Resend emails we send for notifications**. To make them match The Buzz Guide branding, paste the HTML below into:

**Supabase Dashboard** → **Authentication** → **Email Templates** → pick a template type → **Source** tab → paste → **Save**

Repeat for each template type (Confirm signup, Reset password, Magic link, Change email).

The placeholders (`{{ .ConfirmationURL }}` etc.) are filled in by Supabase when the email is sent. Don't change them.

## Site URL

Make sure **Authentication → URL Configuration → Site URL** is set to:
```
https://www.thebuzzguide.co.uk
```

And **Redirect URLs** includes (newline-separated):
```
https://www.thebuzzguide.co.uk/auth/callback
https://www.thebuzzguide.co.uk/auth/magic-bridge
https://www.thebuzzguide.co.uk/**
```

---

## Confirm signup

**Subject**: `Welcome to The Buzz Guide — confirm your email`

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Confirm your email</title>
</head>
<body style="margin:0;padding:0;background-color:#0a0a0d;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#f4f4f5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0a0a0d;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#14141a;border-radius:16px;overflow:hidden;border:1px solid #2a2a35;">
          <tr>
            <td style="padding:32px 32px 16px 32px;text-align:center;">
              <div style="font-family:'Impact','Arial Black',sans-serif;font-size:32px;letter-spacing:1px;color:#fdb913;">🐝 THE BUZZ</div>
              <div style="font-size:11px;color:#8a8a96;letter-spacing:2px;text-transform:uppercase;margin-top:4px;">Gigs · DJs · Nights out</div>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 32px 32px 32px;">
              <h1 style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:26px;font-weight:700;line-height:1.2;margin:24px 0 16px 0;color:#fdb913;letter-spacing:-0.01em;">Welcome aboard.</h1>
              <p style="font-size:15px;line-height:1.6;color:#c8c8cf;margin:0 0 24px 0;">
                Tap the button below to confirm your email and get listed on The Buzz Guide.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
                <tr>
                  <td align="center" style="border-radius:10px;background:#fdb913;">
                    <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:14px 32px;font-size:14px;font-weight:700;color:#000;text-decoration:none;text-transform:uppercase;letter-spacing:1px;">Confirm email →</a>
                  </td>
                </tr>
              </table>
              <p style="font-size:12px;line-height:1.6;color:#8a8a96;margin:32px 0 0 0;">
                If the button doesn't work, copy and paste this URL into your browser:<br>
                <a href="{{ .ConfirmationURL }}" style="color:#fdb913;word-break:break-all;">{{ .ConfirmationURL }}</a>
              </p>
              <p style="font-size:12px;line-height:1.6;color:#8a8a96;margin:16px 0 0 0;">
                Didn't sign up? Ignore this email — your address won't be added to anything.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px;border-top:1px solid #2a2a35;text-align:center;">
              <p style="font-size:11px;color:#8a8a96;margin:0;text-transform:uppercase;letter-spacing:1px;">
                The Buzz Guide · Dundee · <a href="https://www.thebuzzguide.co.uk" style="color:#fdb913;text-decoration:none;">thebuzzguide.co.uk</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

---

## Reset password

**Subject**: `Reset your The Buzz Guide password`

Use the same HTML above, just swap the heading + body copy + button text:

- Heading: `Reset your password.`
- Body: `Tap below to set a new password for your The Buzz Guide account. The link works once and expires in 1 hour.`
- Button: `Reset password →`
- Footer: `Didn't ask for this? Ignore the email — your password stays the same.`

The placeholder `{{ .ConfirmationURL }}` works for this template too.

When the user clicks the link, Supabase delivers them to `/auth/callback`
with `type=recovery` in the URL fragment. The callback-finish handler
detects that and routes them to `/reset-password` (not `/dashboard`) so
they can actually set a new password before being turned loose on the
app.

---

## Magic link

**Subject**: `Your sign-in link for The Buzz Guide`

- Heading: `Tap to sign in.`
- Body: `One-tap sign-in link for The Buzz Guide. Click below — works for the next hour.`
- Button: `Sign in →`
- Footer: `Didn't request this? Ignore it. Nothing happens unless you click.`

---

## Change email

**Subject**: `Confirm your new email on The Buzz Guide`

- Heading: `Confirm your new email.`
- Body: `You asked to change the email on your The Buzz Guide account. Confirm by tapping below.`
- Button: `Confirm new email →`
- Footer: `Didn't request this? You can safely ignore — your existing email stays.`

---

## After saving

1. Send yourself a test signup → check the email
2. The button + colours should match The Buzz Guide site
3. Clicking the button should drop you on `/auth/callback` which exchanges the code and sends you to `/dashboard`
