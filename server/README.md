# Vircadia World Server

Vircadia World is a very simple to use framework for developing connected worlds.

*Warning: Vircadia World is simple relative to all other alternatives, however setting up and deploying your own world still requires some level of technical experience.*

## Installation (Debian/Ubuntu)

### Prerequisites

* Git
* Docker Engine
* Caddy
* NVM
    * Bun.sh
* A domain with subdomains for your world, SSL is required (auto-generated with Caddy)

#### Caddy

[https://caddyserver.com/docs/install](https://caddyserver.com/docs/install)

### Install Dependencies

```sh
bun install
```

## Configuration

* [Supabase](modules/supabase/README.md)
* [Caddy](modules/caddy/README.md)

## Running

### Start the server

```bash
bun run start
```

### Start the reverse proxy

Launch Caddy:

If you installed Caddy normally and it is deployed as a system process, you must first stop the system service before running it again.

```sh
cd modules/caddy
sudo caddy start
```
