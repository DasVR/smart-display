# Self-Hosted Form Relay for Static Sites

A lightweight Go microservice that receives HTTP POSTs from a static/contact form and forwards them via SMTP (Gmail, Cloudflare Email Routing, etc.). Runs as a Docker container behind Caddy + Cloudflare Tunnel.

## Why this pattern

| Approach | Limit | Cost | Privacy |
|----------|-------|------|---------|
| Formspree | 50/mo | Free | Third-party |
| Web3forms | 250/mo | Free | Third-party |
| Supabase Edge Functions | Needs auth config | Free tier | Self-hosted |
| **Self-hosted relay** | Unlimited | Free | Fully self-hosted |

## Architecture

```
User submits form on dasdev.net/contact
    → POST https://formrelay.dasdev.net/submit (CORS-enabled)
    → Cloudflare Tunnel → Caddy → formrelay container :8080
    → Go service validates JSON, sends via SMTP
    → Gmail SMTP → Cloudflare Email Routing → hello@dasdev.net
```

## Go service (main.go)

```go
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/smtp"
	"os"
	"time"
)

type FormPayload struct {
	Name    string `json:"name"`
	Email   string `json:"email"`
	Message string `json:"message"`
}

func main() {
	smtpHost := getEnv("SMTP_HOST", "smtp.gmail.com")
	smtpPort := getEnv("SMTP_PORT", "587")
	smtpUser := getEnv("SMTP_USER", "")
	smtpPass := getEnv("SMTP_PASS", "")
	fromAddr := getEnv("FROM_ADDR", smtpUser)
	toAddr := getEnv("TO_ADDR", "hello@yourdomain.net")
	ntfyUrl := os.Getenv("NTFY_URL") // optional: instant push notifications
	port := getEnv("PORT", "8080")

	if smtpUser == "" || smtpPass == "" {
		log.Fatal("SMTP_USER and SMTP_PASS required")
	}

	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	http.HandleFunc("/submit", func(w http.ResponseWriter, r *http.Request) {
		// CORS headers MUST be set before checking method.
		// The browser sends OPTIONS (preflight) before POST.
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var p FormPayload
		if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}

		if p.Name == "" || p.Email == "" || p.Message == "" {
			http.Error(w, "missing fields", http.StatusBadRequest)
			return
		}

		subject := fmt.Sprintf("[%s] Inquiry from %s", toAddr, p.Name)
		body := fmt.Sprintf("Name: %s\nEmail: %s\nTime: %s\n\n%s",
			p.Name, p.Email, time.Now().Format(time.RFC1123), p.Message)
		msg := []byte(fmt.Sprintf(
			"To: %s\r\nSubject: %s\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n%s",
			toAddr, subject, body))

		auth := smtp.PlainAuth("", smtpUser, smtpPass, smtpHost)
		addr := smtpHost + ":" + smtpPort
		if err := smtp.SendMail(addr, auth, fromAddr, []string{toAddr}, msg); err != nil {
			log.Printf("smtp error: %v", err)
			http.Error(w, "send failed", http.StatusInternalServerError)
			return
		}

		// Optional: push to ntfy for instant notification
		if ntfyUrl != "" {
			go func() {
				ntfyBody, _ := json.Marshal(map[string]string{
					"topic": "dasdev-leads",
					"title": "New lead: " + p.Name,
					"message": p.Email + "\n" + p.Message,
					"priority": "4",
				})
				http.Post(ntfyUrl, "application/json", bytes.NewReader(ntfyBody))
			}()
		}

		log.Printf("sent inquiry from %s <%s>", p.Name, p.Email)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"status": "sent"})
	})

	log.Printf("formrelay listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}

func getEnv(k, fallback string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return fallback
}
```

**Critical:** Set CORS headers **at the very top** of the handler, before any method check. The browser sends `OPTIONS` (preflight) before `POST`. If the handler returns `405` before writing CORS headers, the actual POST is blocked.

**Critical:** Each Gmail account needs its OWN app password. You cannot reuse one account's app password for another. Generate at https://myaccount.google.com/apppasswords.

## Build (static binary for Alpine)

```bash
cd /opt/stacks/foundation/formrelay
go mod init formrelay
go mod tidy
CGO_ENABLED=0 go build -o formrelay .
```

**Critical:** `CGO_ENABLED=0` is required. Alpine uses musl libc, not glibc. A binary built without CGO is fully static and runs in any Linux container.

## Docker Compose service

```yaml
  formrelay:
    image: alpine:latest
    container_name: formrelay
    restart: unless-stopped
    working_dir: /app
    volumes:
      - ./formrelay:/app
    environment:
      - SMTP_HOST=smtp.gmail.com
      - SMTP_PORT=587
      - SMTP_USER=airfryer24@gmail.com
      - SMTP_PASS=your-app-password
      - FROM_ADDR=airfryer24@gmail.com    # NOT the same as TO_ADDR
      - TO_ADDR=arriqaalraee@gmail.com     # or hello@dasdev.net
      - NTFY_URL=http://ntfy:80/dasdev-leads  # optional instant notification
      - PORT=8080
    command: ["/app/formrelay"]
    networks:
      - proxy
```

## Gmail deduplication fix

Gmail deduplicates emails when FROM and TO resolve to the same Gmail inbox (via Cloudflare Email Routing). If `FROM_ADDR` is `hello@dasdev.net` (routed to `arriqaalraee@gmail.com`) and `TO_ADDR` is also `hello@dasdev.net`, the email is silently hidden.

**Fix:** Use a DIFFERENT Gmail account as FROM:
- FROM: `airfryer24@gmail.com` (app password required)
- TO: `arriqaalraee@gmail.com` (main inbox, receives instantly)

## Caddy route

```
@formrelay host formrelay.dasdev.net
handle @formrelay {
    reverse_proxy formrelay:8080
}
```

## Cloudflare Tunnel

```bash
sudo cloudflared tunnel route dns <tunnel-id> formrelay.dasdev.net
```

Then add to `/etc/cloudflared/config.yml`:

```yaml
  - hostname: formrelay.dasdev.net
    service: http://localhost:80
```

## Frontend fetch

```typescript
const res = await fetch("https://formrelay.dasdev.net/submit", {
  method: "POST",
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ name, email, message }),
});
if (!res.ok) throw new Error("send failed");
```

## Gmail App Password

1. Go to https://myaccount.google.com/apppasswords
2. Generate an app password for "Mail"
3. Use that 16-char password (with spaces) as `SMTP_PASS`
4. Store it in `pass` or another secrets manager, never commit it

## Verification commands

```bash
# Check health
curl https://formrelay.dasdev.net/health

# Test preflight (CORS)
curl -I -X OPTIONS \
  -H "Origin: https://dasdev.net" \
  -H "Access-Control-Request-Method: POST" \
  https://formrelay.dasdev.net/submit | grep -i "access-control"

# Test submission with CORS origin
curl -X POST https://formrelay.dasdev.net/submit \
  -H "Content-Type: application/json" \
  -H "Origin: https://dasdev.net" \
  -d '{"name":"Test","email":"test@example.com","message":"hello"}'

# Check container logs
docker logs formrelay --tail 20
```

## Pitfalls

### CORS: OPTIONS preflight before POST
Browsers send `OPTIONS` first. If the handler returns `405` before writing CORS headers, the actual POST is blocked with:
> Response to preflight request doesn't pass access control check: No 'Access-Control-Allow-Origin' header is present.

**Fix:** Write CORS headers at the top of the handler, before any method check. Return 204 for OPTIONS, then check for POST.

### CSP: `connect-src` blocks the fetch
If the site serves a `Content-Security-Policy` header, the frontend `fetch()` to `https://formrelay.dasdev.net` is blocked unless the subdomain is in `connect-src`.

**Fix:** Add the form relay subdomain to the CSP directive:
```
connect-src 'self' https://formrelay.dasdev.net ...
```

If using nginx with a `security-headers.conf`, update both `security-headers.conf` and `private-headers.conf`. Rebuild the Docker image so the new headers are baked in.

### Gmail deduplication hides emails
Gmail deduplicates emails when FROM and TO are the same address (via Cloudflare Email Routing). If `FROM_ADDR` and `TO_ADDR` are both `hello@dasdev.net`, the email lands but Gmail hides it.

**Fix:** Set `FROM_ADDR` to a different Gmail account (e.g., `airfryer24@gmail.com`) and `TO_ADDR` to the main inbox (`arriqaalraee@gmail.com`).

### SMTP auth failures with Gmail
If using 2FA, regular Gmail passwords won't work. You MUST use an App Password.

### Cloudflared config corruption
Repeated `sed -i` edits can break YAML structure. Keep a canonical config file and `cp` it into place.

### Caddyfile stale mount
Container restart required after Caddyfile changes — `docker exec caddy caddy reload` may silently use cached config.

### Alpine + glibc binary
Without `CGO_ENABLED=0`, the binary crashes on Alpine with "not found" or segfault. Always build static.

### Form submissions still failing after all fixes
Check browser console for the exact error. The sequence is usually:
1. CSP blocks the fetch → fix CSP `connect-src`
2. CORS blocks the preflight → fix handler CORS order
3. SMTP fails → check `docker logs formrelay`
4. Email not in inbox → check Gmail dedup / spam / filters
