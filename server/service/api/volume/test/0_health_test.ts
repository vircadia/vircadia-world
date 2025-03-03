import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import type { Subprocess } from "bun";
import type postgres from "postgres";
import { PostgresClient } from "../database/postgres/postgres_client";
import {
    Communication,
    Entity,
} from "../vircadia-world-sdk-ts/schema/schema.general";
import { VircadiaConfig } from "../vircadia-world-sdk-ts/config/vircadia.config";
import {
    cleanupTestAccounts,
    cleanupTestAssets,
    cleanupTestEntities,
    cleanupTestScripts,
    DB_TEST_PREFIX,
    initContainers,
    initTestAccounts,
    TEST_SYNC_GROUP,
    type TestAccount,
} from "./helper/helpers";
import { log } from "../vircadia-world-sdk-ts/module/general/log";

describe("World API Manager - HEALTH", () => {
    test("Health Check", async () => {
        const healthCheckResponse = await Communication.HealthCheck();
        expect(healthCheckResponse).toEqual({
            status: "ok",
        });
    }
});
