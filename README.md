# Vircadia

REALTIME DECLARATIVE WORLDS.

Build worlds faster, ship more features, scale to infinity.

This is the React moment for game development.

Be sure to clone recursively:

```sh
git submodule update --init --recursive
```

## Core features

Vircadia is designed for scale, so you can build games as small as a room, or scale to full open world MMORPGs, using the very same core functionality.

* **PostgreSQL**: Define your world in SQL
* **PostgreSQL**: Get all the features of modern, enterprise databases: transactions, rollbacks, triggers, sub-ms functions, and more, all natively within your game
* **Platforms**: Entities are shared between all clients in realtime (Unreal, Unity, Web, Blender, etc.)
* **Scripting**: Gameplay functionality is executed in scripts by users
* **Scripting**: Administrative / management tasks are executed in scripts by agents
* **High Performance**: Using the `World Tick Manager` service, all entity, script, and asset states are tracked server-side to assist in anti-cheat, competitive gaming, and general gameplay maintenance
* **Enterprise Scale**: All services, including the default web client, are served via Docker containers, enabling full Kubernetes deployment
* **Enterprise Security**: OAuth 2.0, no passwords, validated by partners like T-Systems, UA92, and more
* **Extensible**: New functionality can easily be defined in user/agent scripts or in SQL via PostgreSQL, or as a core service

## License

The core Vircadia project is open source, permissively licensed under Apache 2.0.

**Note: Outside modules not mainly maintained by the Vircadia team may be licensed differently, please check their respective repositories for more information.**

## Vircadia Quantum

The fast track branch for testing the latest features.