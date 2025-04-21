import {
    createSignal,
    onCleanup,
    onMount,
    type JSX,
    createResource,
} from "solid-js";
import { useVircadia } from "../hook/useVircadia";

export interface VircadiaAssetData {
    arrayBuffer: ArrayBuffer;
    blob: Blob;
    type: string;
    url: string;
}

// Use createResource for proper handling of async data fetching
function useVircadiaAsset(assetFileName: string) {
    const vircadia = useVircadia();

    // Using createResource is the recommended way to handle async data loading
    const [assetData, { refetch }] = createResource(async () => {
        try {
            console.log(`Starting to load asset: ${assetFileName}`);

            // Fetch from database
            const result = await vircadia.query<{
                asset__data__bytea: any;
                asset__mime_type: string;
            }>({
                query: `
                    SELECT asset__data__bytea, asset__mime_type
                    FROM entity.entity_assets
                    WHERE general__asset_file_name = $1
                `,
                parameters: [assetFileName],
                timeoutMs: 100000,
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

            console.log(
                `Successfully loaded asset: ${assetFileName}, type: ${mimeType}, size: ${byteArray.length} bytes`,
            );

            return data;
        } catch (err) {
            console.error(`Error loading asset ${assetFileName}:`, err);
            throw err instanceof Error
                ? err
                : new Error("Failed to load asset");
        } finally {
            console.log(`Finished loading attempt for asset: ${assetFileName}`);
        }
    });

    // Clean up URL object when component unmounts
    onCleanup(() => {
        const data = assetData();
        if (data?.url) {
            URL.revokeObjectURL(data.url);
        }
    });

    return assetData;
}

interface VircadiaAssetProps {
    fileName: string;
    children: (props: {
        assetData: VircadiaAssetData | null;
        loading: boolean;
        error: Error | null;
    }) => JSX.Element;
}

export function VircadiaAsset(props: VircadiaAssetProps) {
    const resource = useVircadiaAsset(props.fileName);

    // With createResource, these properties are reactive
    return props.children({
        assetData: resource() || null,
        loading: resource.loading,
        error: resource.error,
    });
}
