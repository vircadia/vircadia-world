#!/bin/bash
set -e

# Install build dependencies
apt-get update
apt-get install -y curl build-essential pkg-config libssl-dev

# Install Rust and Trunk
curl https://sh.rustup.rs -sSf | sh -s -- -y
source $HOME/.cargo/env
cargo install pg-trunk

# Install and create specified extensions
for ext in ${POSTGRES_EXTENSIONS//,/ }; do
    echo "Installing extension: $ext"
    trunk install "$ext"
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
        CREATE EXTENSION IF NOT EXISTS "$ext";
EOSQL
done