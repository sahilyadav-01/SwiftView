# Security Model and Release Gates

## Security principles

- Deny by default. Device discovery never grants access.
- Authenticate the user, device, and individual session.
- Grant only requested and approved capabilities.
- Keep privileged native operations behind a narrow, authenticated interface.
- Make active access visible to the device user.
- Record security-relevant actions in an append-only audit trail.
- Never log passwords, refresh tokens, private keys, clipboard contents, file contents, SDP credentials, or TURN credentials.

## Protected assets

- User accounts and organization membership.
- Device private keys and enrollment tokens.
- Session authorization and transport keys.
- Screen content, input events, clipboard content, and transferred files.
- Audit integrity and agent update signing keys.
- Control-plane and relay credentials.

## Primary threats and controls

| Threat | Required controls |
|---|---|
| Device-ID guessing | IDs are identifiers only; rate limits; no metadata disclosure; authenticated session authorization |
| Stolen user password | Argon2id; MFA; risk-based lockout; refresh-token rotation; session revocation |
| Stolen device credential | Non-exportable key when possible; key rotation; revocation; device posture and anomaly alerts |
| Signaling impersonation | TLS; authenticated upgrade; session-bound audience and nonce; strict participant checks |
| Replay | Short token lifetime; nonce; timestamp window; message IDs; monotonic permission version |
| Cross-tenant access | Organization scope in every query; authorization service; negative tests; database constraints |
| Unauthorized input | Separate permission; agent-side enforcement; immediate revoke; visible active-session state |
| Path traversal/file overwrite | Approved root; normalized relative path; no `..`; quotas; explicit conflict behavior; hashes |
| Relay observation | End-to-end session protection; relay receives no authorization power or long-lived app secrets |
| Malicious update | Offline-protected signing key; signed manifest and binary; version pinning; rollback protection |
| Audit tampering | Append-only permissions; external export; hash/checkpoint strategy; restricted retention jobs |
| Brute force/abuse | Per-account, per-IP, per-device, and per-organization limits; backoff; alerts |
| Privilege escalation | Split service/UI processes; least-privilege service account; authenticated IPC; code signing |

## Authentication requirements

- Access tokens: maximum 15-minute lifetime.
- Refresh tokens: opaque, stored only as hashes, rotated on every use, and family-revoked on reuse.
- Enrollment tokens: single use, maximum 15-minute lifetime.
- Session-connect credentials: single session, peer role and audience bound, maximum 2-minute connection window.
- Unattended access: MFA-capable technician identity plus device policy; never enabled merely by knowing a password or public device ID.
- Secrets at rest: use a managed secret store in production; do not commit secrets or place them in image layers.

## Authorization matrix

| Action | Viewer | Technician | IT manager | Admin | Super admin |
|---|---:|---:|---:|---:|---:|
| View assigned devices | yes | yes | yes | yes | yes |
| Request attended session | no | yes | yes | yes | yes |
| Request unattended session | no | policy | policy | policy | policy |
| Change active permissions | no | within grant | yes | yes | yes |
| Manage groups/assignments | no | no | yes | yes | yes |
| Manage users/policies | no | no | limited | yes | yes |
| Revoke devices | no | no | limited | yes | yes |
| Configure relays/signing | no | no | no | limited | yes |

Resource assignment and organization scope are evaluated in addition to role.

## Consent requirements

The attended-session prompt must show:

- technician display name and organization;
- requested capabilities in plain language;
- whether files or clipboard can leave the device;
- Allow and Reject actions with equal clarity;
- a countdown after which the request expires.

While connected, the local UI must show an always-visible indicator and an immediate end-session control. Consent cannot be inferred from inactivity.

## File-transfer safety

- Disabled by default and granted independently for each direction.
- Maximum file and session quotas enforced at both API and agent.
- File manifest approved before content is accepted.
- Destination constrained to an administrator-approved directory.
- Temporary partial file uses a non-executable extension and is promoted only after SHA-256 verification.
- Existing files are never silently overwritten.
- Malware scanning hook is required before enterprise release.
- Every transfer start, completion, failure, and cancellation is audited without logging file content.

## Update safety

1. Agent retrieves a signed manifest over TLS.
2. Agent verifies manifest signature against an embedded update key.
3. Agent downloads the package and verifies length and digest.
4. OS signature and publisher are checked.
5. Update installs through a constrained helper.
6. Health check confirms the new version; otherwise rollback executes.
7. Downgrade requires an explicit, signed emergency policy.

## Production release gates

- Independent threat-model review and penetration test complete.
- Tenant-isolation and authorization test suites pass.
- No critical/high dependency or container vulnerabilities without an approved exception.
- Agent binaries and installer are signed.
- Key rotation, device revocation, backup restore, and relay failure have been exercised.
- Consent and active-session UI pass usability review.
- Security event alerting and incident runbook are operational.
- Privacy notice, retention policy, and authorized-use terms are approved.

## Current prototype warnings

The root Node prototype intentionally remains a development MVP. It exposes a host command endpoint and uses in-memory signaling state. Do not expose it to the public internet or market it as production-ready until authentication, authorization, persistence, audit, and rate limits from this specification are implemented.

