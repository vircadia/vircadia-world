# Use the official PostgreSQL image as a base
FROM postgres:latest

# Switch to root user to install packages
USER root

# Update package lists and install necessary packages
RUN apt-get update && apt-get install -y \
    curl build-essential pkg-config libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Rust and Trunk
RUN curl https://sh.rustup.rs -sSf | sh -s -- -y \
    && source $HOME/.cargo/env \
    && cargo install pg-trunk

# Switch to postgres user for database operations
USER postgres

# Install and create specified extensions
RUN for ext in ${POSTGRES_EXTENSIONS//,/ }; do \
        echo "Installing extension: $ext"; \
        trunk install "$ext"; \
        psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -c "CREATE EXTENSION IF NOT EXISTS \"$ext\";"; \
    done