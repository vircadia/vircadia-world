import type { World } from "../../../sdk/vircadia-world-sdk-ts/schema/schema";

export type EntityRow = World.Tables<"entities">;
export type EntityMetadataRow = World.Tables<"entities_metadata">;

export type EntityUpdate = {
    entity: EntityRow;
    timestamp: number;
};

export type MetadataUpdate = {
    metadata: EntityMetadataRow;
    timestamp: number;
};
