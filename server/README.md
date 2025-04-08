# Services

### [World API Manager](./service/world_api_manager/README.md)

The World API Manager is the interface between clients and the PostgreSQL database, and any other services that might be utilized.

### [World Tick Manager](./service/world_tick_manager/README.md)

The World Tick Manager is in charge of tracking changes in the world at fixed intervals to enable advanced features such as anti-cheat, lag compensation, and more.

### PostgreSQL

The PostgreSQL service runs a vanilla PostgreSQL instance, this serves as the primary data store for the game.

### PGWeb

The PGWeb service is a service that allows you to manage the PostgreSQL database via a web interface.