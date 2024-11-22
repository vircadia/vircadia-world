# Vircadia World Server

Vircadia World is a very simple to use framework for developing connected worlds.

*Warning: Vircadia World is simple relative to all other alternatives, however setting up and deploying your own world still requires some level of technical experience.*

## Installation

### Prerequisites

* Git
* Docker
* Caddy
* unzip
* A domain with subdomains for your world, SSL is required (auto-generated with Caddy)

#### Install unzip (if not already installed)

On Ubuntu/Debian:
```sh
sudo apt-get update && sudo apt-get install unzip
```

On CentOS/RHEL:
```sh
sudo yum install unzip
```

#### Bun

Install Bun directly using their install script:

```sh
curl -fsSL https://bun.sh/install | bash
```

After installation, restart your terminal or run:
```sh
source ~/.bashrc  # or source ~/.zshrc if using zsh
```

#### Supabase CLI

Install Supabase CLI globally using Bun:

```sh
bun install -g supabase
```

Be sure to add the global bin folder to your PATH, e.g. for a user named "user":

```sh
warn: To run "supabase", add the global bin folder to $PATH:

export PATH="/home/user/.bun/bin:$PATH"
```

You can then use Supabase CLI with `bunx supabase` commands.

#### Docker

[https://docs.docker.com/engine/install/](https://docs.docker.com/engine/install/)

After installing Docker, make sure your user is in the docker group to run Docker commands without sudo:

```sh
sudo usermod -aG docker $USER
newgrp docker
```

#### Caddy

[https://caddyserver.com/docs/install](https://caddyserver.com/docs/install)

### Install dependencies

```bash
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
