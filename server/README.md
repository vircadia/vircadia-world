# Vircadia World Server

Vircadia World is a very simple to use framework for developing connected worlds.

*Warning: Vircadia World is simple relative to all other alternatives, however setting up and deploying your own world still requires some level of technical experience.*

## Installation

### Prerequisites

*Notice: Homebrew requires a non-root user to operate correctly, so you should create or use a non-root administrator account to complete this process and operate the Vircadia World Server.*

* Git
* Homebrew
* Docker

#### Homebrew

Install Homebrew correctly, including all extras they recommend.

Then install the Supabase and Bun.sh with Homebrew:

```sh
# Supabase CLI
brew tap supabase/tap
brew install supabase

# Bun
brew tap oven-sh/bun
brew install bun
```

#### Docker

You must install Docker as well: [https://docs.docker.com/engine/install/](https://docs.docker.com/engine/install/).

After installing Docker, make sure your user is in the docker group to run Docker commands without sudo:

```sh
sudo usermod -aG docker $USER
newgrp docker
```

### Install dependencies

```bash
bun install
```

## Configuration

* [Supabase](modules/supabase/README.md)

### Reverse Proxy (Production)

You should use a reverse proxy to make your world available publicly, you can use any app / service to do this, but generally we recommend Caddy for its simplicity.

Where `54321` and `54323` are your Supabase API and Studio ports (adjust if you change your API or Studio port in `modules/supabase/app/supabase/config.toml`):

```
{
    # Global options block
    # Use staging CA during testing
    # acme_ca https://acme-staging-v02.api.letsencrypt.org/directory
}

api.[your-domain].com {
    tls {
        on_demand
    }
    
    reverse_proxy localhost:54321 {
        header_up Host {http.request.host}
    }
}

studio.[your-domain].com {
    tls {
        on_demand
    }
    
    reverse_proxy localhost:54323 {
        header_up Host {http.request.host}
        header_up X-Real-IP {http.request.remote}
    }
}
```

## Running

```bash
bun run start
```
