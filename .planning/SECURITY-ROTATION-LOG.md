# Security — Secret Rotation Log

Append-only record of credential rotations. Used for audit / due-diligence
and to catch recurring exposure patterns.

## 2026-05-19 — Mass rotation (post Phase 2 smoke testing)

**Reason:** During Phase 2 build + smoke test, the following secrets were
shared in this Claude Code conversation (either pasted by the user or read
from `.env.local` via the Read tool, which captures file contents into
the conversation transcript). Defence-in-depth rotation.

**Rotated:**

| Key | Provider | Path |
|---|---|---|
| `VOYAGE_API_KEY` | Voyage AI dashboard | Create new key → swap in Vercel + .env.local → delete old |
| `TURNSTILE_SECRET_KEY` (and `NEXT_PUBLIC_TURNSTILE_SITE_KEY` if widget recreated) | Cloudflare Turnstile | Rotate secret on widget OR create new widget; swap |
| `OUTLOOK_CLIENT_SECRET` | Azure Entra ID App registrations → "Altus" | New client secret created; old deleted in Azure |
| `OUTLOOK_WEBHOOK_CLIENT_STATE_SECRET` | Self-generated (`openssl rand -hex 32`) | New value; existing Microsoft Graph subscription needs recreation to pick up new clientState — see verification |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys | New key created; old key deleted |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase API Keys tab → new `sb_secret_*` system | Migrated from legacy `service_role` JWT to new `sb_secret_*` format; legacy key disabled |
| `INNGEST_EVENT_KEY` | app.inngest.com → Keys | Rotated |
| `INNGEST_SIGNING_KEY` | app.inngest.com → Keys | Rotated |

**Not rotated (deliberate):**

| Key | Reason |
|---|---|
| `EMAIL_TOKEN_ENCRYPTION_KEY` | User assessed exposure risk as low. Symmetric AES-256-GCM key; only protects OAuth refresh tokens in `outlook_credentials` table. An attacker would also need DB access to ciphertext. Defence-in-depth coverage. Revisit if exposure pattern changes. |

**Reminders set:**

- **2028-04-15** — Rotate `OUTLOOK_CLIENT_SECRET` before Azure 24-month expiry (~2028-05-19). Integration silently dies the day after expiry.

**Verification after rotation:**

- Sign-in + dashboard load → Supabase service role OK
- `/search` semantic query → Voyage OK
- `/jobs/[id]/matches` → Anthropic Sonnet OK
- `/settings/integrations` → reconnect Outlook → consent OK → client secret OK
- `/apply/altus` submission → Turnstile + apply-form path OK
- CV upload → parse complete → Inngest signing + event keys OK + Anthropic Haiku OK + Voyage OK
- Inbound Outlook email → activity timeline row → webhook clientState OK (after subscription recreation)

**Lessons:**

- Reading `.env.local` via the Read tool puts the file contents into the
  conversation transcript. For future sessions, prefer to NOT read this
  file unless we need to. The user can paste specific values into chat
  if needed for diagnosis, and we treat those as compromised after the
  session.
- Inngest env vars need ALL THREE environment scopes ticked in Vercel
  (Production, Preview, Development). Default UI behaviour ticks only
  Preview if you're not careful; this caused a Phase 2 surface where
  production Inngest signing was unset until caught by smoke test.
- Mass rotation in a single session is workable for a 3-person team
  but the encryption-key + webhook-clientState items have stateful
  cleanup steps (re-OAuth / subscription recreation) that must follow
  the env-var swap.

---

(future rotations append below this line)
