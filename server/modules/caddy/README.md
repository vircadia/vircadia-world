# Caddy

You should use a reverse proxy to make your world available publicly, you can use any app / service to do this, but generally we recommend Caddy for its simplicity.

Where `54321` and `54323` are your Supabase API and Studio ports (adjust if you change your API or Studio port in `modules/supabase/app/supabase/config.toml`), you must also use your own subdomains: [Caddyfile](modules/caddy/Caddyfile)

## Open Required Ports

The following ports need to be accessible from the internet:
- 443 (HTTPS)
- 80 (HTTP)

Note: Ports 54321 (Supabase API) and 54323 (Supabase Studio) should only be accessible locally as they will be proxied through Caddy.

```sh
sudo ufw allow 443
sudo ufw allow 80
sudo ufw enable
sudo ufw status
```
