import type { Database } from "../../../sdk/vircadia-world-sdk-ts/schema/schema.database";

export type EntityRow = Database["public"]["Tables"]["entities"];
export type EntityMetadataRow =
    Database["public"]["Tables"]["entities_metadata"];

export type EntityUpdate = {
    entity: EntityRow;
    timestamp: number;
};

export type MetadataUpdate = {
    metadata: EntityMetadataRow;
    timestamp: number;
};
