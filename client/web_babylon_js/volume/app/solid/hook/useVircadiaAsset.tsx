import { createSignal, createEffect, onCleanup } from "solid-js";
import { useVircadia } from "./useVircadia";

export interface VircadiaAssetData {
    arrayBuffer: ArrayBuffer;
    blob: Blob;
    type: string;
    url: string;
}

export function useVircadiaAsset(assetFileName: string) {
    const [assetData, setAssetData] = createSignal<VircadiaAssetData | null>(
        null,
    );
    const [error, setError] = createSignal<Error | null>(null);
    const [loading, setLoading] = createSignal(true);
    const executeQuery = useVircadia().query;

    createEffect(async () => {
        try {
            setLoading(true);
            setError(null);

            // Fetch from database
            const result = await executeQuery<{
                asset__data__bytea: any;
                asset__mime_type: string;
            }>({
                query: `
                    SELECT asset__data__bytea, asset__mime_type
                    FROM entity.entity_assets
                    WHERE general__asset_file_name = $1
                `,
                parameters: [assetFileName],
            });

            if (!result.length) {
                throw new Error(`Asset ${assetFileName} not found`);
            }

            // Process bytea data
            const rawData = result[0].asset__data__bytea;
            const mimeType = result[0].asset__mime_type;

            // Handle bytea data in different formats
            let byteArray: number[] = [];
            if (
                rawData &&
                typeof rawData === "object" &&
                "data" in rawData &&
                Array.isArray((rawData as unknown as any).data)
            ) {
                byteArray = (rawData as unknown as any).data;
            } else if (Array.isArray(rawData)) {
                byteArray = rawData;
            }

            // Convert to array buffer and blob
            const uint8Array = new Uint8Array(byteArray);
            const arrayBuffer = uint8Array.buffer;
            const blob = new Blob([uint8Array], { type: mimeType });
            const url = URL.createObjectURL(blob);

            const data: VircadiaAssetData = {
                arrayBuffer,
                blob,
                type: mimeType,
                url,
            };

            setAssetData(data);
        } catch (err) {
            const errorObj =
                err instanceof Error ? err : new Error("Failed to load asset");
            setError(errorObj);
        } finally {
            setLoading(false);
        }
    });

    // Clean up URL object when component unmounts
    onCleanup(() => {
        const data = assetData();
        if (data?.url) {
            URL.revokeObjectURL(data.url);
        }
    });

    return {
        get assetData() {
            return assetData();
        },
        get error() {
            return error();
        },
        get loading() {
            return loading();
        },
    };
}
