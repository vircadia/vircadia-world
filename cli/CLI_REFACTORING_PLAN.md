# CLI Refactoring Plan

Simplify the CLI from ~4400 lines of repetitive switch cases and 90+ package.json scripts to a composable service+action pattern.

## Proposed Command Structure

### Core Pattern
```bash
bun cli <service-or-group> <action> [options]
```

### Service Aliases

| Alias(es) | Container/Target | Category |
|-----------|------------------|----------|
| `postgres`, `pg`, `db` | `vircadia_world_postgres` | infra |
| `pgweb` | `vircadia_world_pgweb` | infra |
| `caddy` | `vircadia_world_caddy` | infra |
| `ws`, `api-ws` | `vircadia_world_api_ws_manager` | api |
| `auth`, `api-auth` | `vircadia_world_api_rest_auth_manager` | api |
| `asset`, `api-asset` | `vircadia_world_api_rest_asset_manager` | api |
| `inference`, `api-inference` | `vircadia_world_api_rest_inference_manager` | api |
| `state` | `vircadia_world_state_manager` | core |
| `client` | Web Babylon.js client | client |
| `sdk` | TypeScript SDK | dev |
| `cli` | CLI itself | dev |
| `repo` | Root repository | dev |

### Group Aliases

| Group | Includes |
|-------|----------|
| `all` | All services |
| `core` | postgres + pgweb + all API services + state |
| `api` | ws + auth + asset + inference |
| `infra` | postgres + pgweb + caddy |
| `server` | Alias for `core` |

---

## Action Verbs

### Container Actions (Docker services)

| Action | Description | Docker Equivalent |
|--------|-------------|-------------------|
| `up` | Start service(s) | `docker compose up` |
| `down` | Stop service(s) | `docker compose down` |
| `restart` | Stop then start | `down` + `up` |
| `clean` | Stop and remove volumes | `docker compose down -v` |
| `health` | Check container health | `docker inspect` |
| `logs` | View container logs | `docker compose logs` |
| `rebuild` | Clean + build + up | Full rebuild |

### Dependency Actions (Node/Bun packages)

| Action | Description | Target |
|--------|-------------|--------|
| `install` | Install dependencies | `node_modules` |
| `uninstall` | Remove `node_modules` | `rimraf node_modules` |
| `build` | Build/compile the project | TypeScript, Vite, etc. |
| `dev` | Start dev server | Vite dev, etc. |

### Database Actions (postgres-specific)

| Action | Description |
|--------|-------------|
| `migrate` | Run database migrations |
| `seed` | Seed SQL and/or assets |
| `wipe` | Drop and recreate schema |
| `backup` | Export database dump |
| `restore` | Import database dump |
| `token` | Generate system token |

---

## Command Examples

### Container Management
```bash
# Start all core services
bun cli core up -d

# Start specific services with build
bun cli postgres ws auth up --build -d

# Stop everything
bun cli all down

# Full clean (removes volumes)
bun cli all clean

# Rebuild API services
bun cli api rebuild

# Check health
bun cli all health
bun cli postgres health --wait --timeout 60000
```

### Dependency Management
```bash
# Install all dependencies
bun cli all install

# Clean all node_modules
bun cli all uninstall

# Install and build SDK
bun cli sdk install build

# Fresh reinstall of client
bun cli client uninstall install

# Build everything
bun cli all build
```

### Database Operations
```bash
bun cli db migrate
bun cli db seed --sql --assets
bun cli db seed --assets --sync-group textures
bun cli db wipe
bun cli db backup
bun cli db restore
bun cli db token           # Generate token
bun cli db token --raw     # Print only token
```

### Client Development
```bash
bun cli client dev                # Standard dev
bun cli client dev --local        # Connect to localhost
bun cli client build              # Production build
bun cli client build --docker     # Docker-optimized build
```

### Configuration
```bash
bun cli config                    # Interactive menu
bun cli config list               # Show all current values
bun cli config set <key> <value>  # Set specific config
bun cli config unset <key>        # Unset config
```

### Meta/Lifecycle Commands
```bash
bun cli init                      # Full project init
bun cli init --core               # Core services only
bun cli upgrade                   # Down + init (preserves data)
bun cli upgrade --clean           # Full rebuild (wipes data)
```

---

## Operation Sequencing & Dependencies

The new CLI must respect strict ordering requirements, particularly for `server:init` and database operations, as defined in the current `package.json`.

### Service Dependencies
Services will be defined with priorities or dependencies in `service.registry.ts` to ensure correct start/stop order.

| Service | Dependency / Order | Reason |
|---------|--------------------|--------|
| `postgres` | **Priority 0** (First Up, Last Down) | All other services depend on the DB. |
| `sdk` | **Build Priority 0** | Must be built before services that import it. |
| `api-*`, `state` | **Priority 10** (After DB) | Cannot function without DB. |
| `caddy` | **Priority 20** (Last Up) | Ingress should open only when upstreams are ready. |

### Complex Workflows

**Initialization (`init`) Sequence:**
1. **Install & Build SDK**: `sdk` install -> `sdk` build
2. **Install Repo**: `repo` install
3. **Build Services**: `api-*`, `state`, `pgweb`
4. **Start Database**: `postgres` up
5. **Wait for Health**: `postgres` health check
6. **Database Setup**: `migrate` -> `seed:sql` -> `seed:assets` -> `mark-as-ready`
7. **Start Application Services**: `api-*`, `state`, `pgweb` up

**Maintenance (Backup/Restore/Wipe):**
1. **Stop Consumers**: `api-*`, `state`, `pgweb` down
2. **Perform Operation**: `backup` / `restore` / `wipe` on `postgres`
3. **Restart Consumers**: `api-*`, `state`, `pgweb` up (if they were running)

**Refactoring Implication:**
The `Command Parser` or `Action Handlers` must be capable of:
*   Topological sort or priority-based execution for `up`/`down`.
*   executing "pre-hooks" or "post-hooks" for specific actions (e.g., `db:restore` pre-hook = stop apps).

---

## Proposed File Structure

```
cli/
├── lib/
│   ├── service.registry.ts    # Service/alias definitions
│   ├── action.handlers.ts     # Container action handlers  
│   ├── dep.handlers.ts        # Dependency action handlers
│   ├── db.handlers.ts         # Database action handlers
│   ├── command.parser.ts      # Command parsing logic
│   └── utils.ts               # Shared utilities
├── vircadia.cli.ts            # Main entry (much smaller)
├── vircadia.cli.config.ts     # Config (unchanged)
└── package.json               # Simplified scripts
```

---

## Simplified package.json Scripts

Reduce from 90+ scripts to ~20:

```json
{
  "scripts": {
    "cli": "bun vircadia.cli.ts",
    
    "init": "bun run cli init",
    "init:core": "bun run cli init --core",
    "init:all": "bun run cli init --all",
    
    "up": "bun run cli core up -d",
    "down": "bun run cli all down",
    "restart": "bun run cli core restart",
    "health": "bun run cli all health",
    "logs": "bun run cli core logs --follow",
    
    "clean": "bun run cli all clean",
    "clean:deps": "bun run cli all uninstall",
    "install:all": "bun run cli all install",
    "build:all": "bun run cli all build",
    
    "dev": "bun run cli client dev",
    "dev:local": "bun run cli client dev --local",
    "build": "bun run cli client build",
    
    "db:migrate": "bun run cli db migrate",
    "db:seed": "bun run cli db seed",
    "db:backup": "bun run cli db backup",
    "db:restore": "bun run cli db restore",
    
    "config": "bun run cli config",
    "test": "bun run cli test"
  }
}
```

---

## Migration Path

1. **Phase 1**: Add new modules alongside existing code (no breaking changes)
2. **Phase 2**: Route new-style commands through new handlers
3. **Phase 3**: Add deprecation warnings to old commands
4. **Phase 4**: Update docs to use new commands
5. **Phase 5** (future): Remove legacy command support
