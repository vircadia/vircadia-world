# Get started

## Prerequisites

* [Bun](https://bun.sh/)
* [Docker](https://www.docker.com/)

## Clone the repository

Be sure to clone recursively:

```sh
git clone https://github.com/vircadia/vircadia-world.git --recursive
```
or
```sh
git submodule update --init --recursive
```

## Deploy

Afterward, use the [CLI](./cli/README.mdx) to start the project.

## License

The core Vircadia project is open source, permissively licensed under Apache 2.0.

**Note: Outside modules not mainly maintained by the Vircadia team may be licensed differently, please check their respective repositories for more information.**

## Vircadia Quantum

The fast track branch for testing the latest features. (coming soon...)

<!-- TODO: We should remove all the SDK submods, and mount the ENTIRE repo to docker but only use the workingdirs, so that we only have one version of files needed. -->