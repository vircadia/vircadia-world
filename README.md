# Introduction

## Get started

:::note
This is a work in progress and is not yet ready for production use until the version becomes 1.0.0 or higher unless you have direct support from the Vircadia team.
:::

### Clone the repository

Be sure to clone recursively:

```sh
git clone https://github.com/vircadia/vircadia-world.git --recursive
```
or if you've already cloned the repo:
```sh
git submodule update --init --recursive
```

Pull any assets with Git LFS:

```sh
git lfs install
git lfs pull
```

### Deploy

Afterward, use the [CLI](./cli/README.mdx) to install and deploy the project.

## Architecture

```mermaid
graph TB
    subgraph K8s["Kubernetes (Optional)"]
        subgraph DockerCompose["Docker Compose"]
            subgraph APIContainer["API Container"]
                API["World API Manager<br/>(WebSockets & REST)"]
            end
            
            subgraph StateContainer["State Container"]
                State["World State Manager<br/>(Ticks & Entity Lifecycle)"]
            end
            
            subgraph PGWebContainer["PGWeb Container"]
                PGWeb["PGWeb<br/>(Admin Interface)"]
            end
            
            subgraph DBContainer["Database Container"]
                Postgres[("Postgres Database<br/>(All State & Auth)")]
            end
            
            API --> Postgres
            State --> Postgres
            PGWeb --> Postgres
        end
    end
    
    CLI["CLI Tooling<br/>(Configure & Deploy)"]
    Client["Client<br/>(No Container)"]
    
    CLI -.->|Deploy & Configure| DockerCompose
    CLI -.->|Configure & Deploy| Client
    Client -->|WebSocket/REST| API
    
    classDef database fill:#e1f5fe
    classDef service fill:#f3e5f5
    classDef external fill:#fff3e0
    classDef container fill:#e8f5e8
    classDef containerGroup fill:#f0f8f0
    
    class Postgres database
    class API,State,PGWeb service
    class CLI,Client external
    class APIContainer,StateContainer,PGWebContainer,DBContainer container
    class DockerCompose,K8s containerGroup
```

See the main [website](https://vircadia.com) for an alternate overview of the features available.

## Next

The `next` branch is where new updates are merged before being pushed to `master`.
