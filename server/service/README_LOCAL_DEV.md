# Local Development Configuration

## HTTP vs HTTPS on Localhost

By default, Caddy will automatically upgrade `localhost` requests to HTTPS (redirecting HTTP to HTTPS) if the domain is just "localhost". This can cause CORS issues with the browser client during local development (specifically, `OPTIONS` preflight requests failing on the 308 Redirect).

To fix this, we ensure Caddy serves **HTTP** on port 80 without redirection.

### CLI (Recommended)
If you start the server using the CLI (`bun run restart` or `bun run up`), this is handled automatically. The CLI detects if you are running on localhost and configures Caddy correctly.

### Manual Docker Compose
If you run `docker compose up` manually, you must ensure your `.env` file (in this directory) has the following configuration:

```env
VRCA_SERVER_SERVICE_CADDY_DOMAIN=http://localhost
```

Prepending `http://` forces Caddy to bind to the HTTP port and disables the automatic HTTPS upgrade/redirect behavior.
