# Account recovery

## User flow

1. Open **Forgot password**, enter the registered email and an optional message, then submit.
2. The page gives the same acknowledgement for registered and unregistered email addresses. No email is sent automatically.
3. Contact the administrator from the registered email to establish account ownership.
4. After verification, the administrator sets and privately shares a temporary password.
5. Sign in within 24 hours, enter the temporary password and choose a different password (12–128 characters). The server blocks access to workspace APIs until this is complete.
6. The request becomes Resolved and a new session opens the dashboard.

## Admin flow

The Admin panel shows the latest recovery request for each account, including name, email, message, requested time and Pending/Resolved/Rejected status. Use **Refresh requests** for updates.

Select **Verify & reset**, confirm ownership was checked, and enter a temporary password and your own admin password. The temporary password is not stored in readable form and is not sent by the app. Share it privately with the verified owner.

After reset, the request stays Pending (awaiting password change) until the owner replaces the temporary password. Reissue a temporary password if it expires. Requests that have not had a password issued can be rejected.

Only one pending request is retained per account. Repeated requests do not change an existing pending request. A new request after resolution/rejection replaces the previous entry; this is not a full audit-history system. Admin-account recovery is not available through this user-facing flow.

## Storage and controls

- Recovery metadata and password-change flags are saved on the existing user document, in MongoDB or the local development store. No new environment variables or email service are required.
- Passwords use salted PBKDF2 hashes. Password versions invalidate old sessions, including sessions created concurrently with a reset.
- Admin write actions require administrator access and CSRF checks. Password resets additionally require admin-password reauthentication and ownership confirmation.
- Public requests have bounded per-process rate limits and per-account pending/cooldown checks. Multi-instance deployments should add shared/edge rate limiting for stronger abuse protection.
- Existing users without password-version metadata keep working until a reset changes their version.

No browser or API tests were run for this implementation.
