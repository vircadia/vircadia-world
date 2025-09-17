// =============================================================================
// ============================== IMPORTS, TYPES, AND INTERFACES ==============================
// =============================================================================

import type { Service } from "../../../../../../sdk/vircadia-world-sdk-ts/schema/src/vircadia.schema.general";

// =================================================================================
// ================ METRICS COLLECTOR: Efficient Query Performance Tracking ==================
// =================================================================================

export class MetricsCollector {
    private queryTimes: number[] = [];
    private requestSizes: number[] = [];
    private responseSizes: number[] = [];
    private queryCount = 0;
    private failedQueryCount = 0;
    private lastSecondQueries = 0;
    private currentSecondStart = Math.floor(Date.now() / 1000);
    private queriesThisSecond = 0;
    private peakQueriesPerSecond = 0;
    private totalQueryTime = 0;
    private totalRequestSize = 0;
    private totalResponseSize = 0;
    private startTime = Date.now();

    // System metrics tracking
    private cpuUserTimes: number[] = [];
    private cpuSystemTimes: number[] = [];
    private memoryHeapUsed: number[] = [];
    private memoryHeapTotal: number[] = [];
    private memoryExternal: number[] = [];
    private memoryRss: number[] = [];
    private connectionCounts: number[] = [];
    private dbConnectionCounts: number[] = [];
    private totalConnections = 0;
    private failedConnections = 0;

    // Reflect metrics tracking
    private reflectTimes: number[] = [];
    private reflectMessageSizes: number[] = [];
    private reflectCount = 0;
    private reflectDeliveredCount = 0;
    private reflectAcknowledgedCount = 0;
    private failedReflectDeliveries = 0;
    private lastSecondReflects = 0;
    private currentSecondReflectStart = Math.floor(Date.now() / 1000);
    private reflectsThisSecond = 0;
    private peakReflectsPerSecond = 0;
    private totalReflectTime = 0;
    private totalReflectMessageSize = 0;

    // Circular buffers for percentile calculations (keep last 1000 samples)
    private readonly MAX_SAMPLES = 1000;

    recordQuery(
        durationMs: number,
        requestSizeBytes: number,
        responseSizeBytes: number,
        success: boolean,
    ) {
        const currentSecond = Math.floor(Date.now() / 1000);

        // Track queries per second
        if (currentSecond !== this.currentSecondStart) {
            this.lastSecondQueries = this.queriesThisSecond;
            this.peakQueriesPerSecond = Math.max(
                this.peakQueriesPerSecond,
                this.queriesThisSecond,
            );
            this.queriesThisSecond = 0;
            this.currentSecondStart = currentSecond;
        }
        this.queriesThisSecond++;

        // Record metrics
        this.queryCount++;
        if (!success) {
            this.failedQueryCount++;
        }

        this.totalQueryTime += durationMs;
        this.totalRequestSize += requestSizeBytes;
        this.totalResponseSize += responseSizeBytes;

        // Maintain circular buffers for percentile calculations
        if (this.queryTimes.length >= this.MAX_SAMPLES) {
            this.queryTimes.shift();
            this.requestSizes.shift();
            this.responseSizes.shift();
        }

        this.queryTimes.push(durationMs);
        this.requestSizes.push(requestSizeBytes);
        this.responseSizes.push(responseSizeBytes);
    }

    recordSystemMetrics(
        cpuUsage: { user: number; system: number },
        memoryUsage: {
            heapUsed: number;
            heapTotal: number;
            external: number;
            rss: number;
        },
        connectionCount: number,
        dbConnectionCount: number,
        connectionSuccess = true,
    ) {
        // Track connection metrics
        this.totalConnections++;
        if (!connectionSuccess) {
            this.failedConnections++;
        }

        // Maintain circular buffers for system metrics
        if (this.cpuUserTimes.length >= this.MAX_SAMPLES) {
            this.cpuUserTimes.shift();
            this.cpuSystemTimes.shift();
            this.memoryHeapUsed.shift();
            this.memoryHeapTotal.shift();
            this.memoryExternal.shift();
            this.memoryRss.shift();
            this.connectionCounts.shift();
            this.dbConnectionCounts.shift();
        }

        this.cpuUserTimes.push(cpuUsage.user);
        this.cpuSystemTimes.push(cpuUsage.system);
        this.memoryHeapUsed.push(memoryUsage.heapUsed);
        this.memoryHeapTotal.push(memoryUsage.heapTotal);
        this.memoryExternal.push(memoryUsage.external);
        this.memoryRss.push(memoryUsage.rss);
        this.connectionCounts.push(connectionCount);
        this.dbConnectionCounts.push(dbConnectionCount);
    }

    recordReflect(
        durationMs: number,
        messageSizeBytes: number,
        delivered: number,
        acknowledged: boolean,
    ) {
        const currentSecond = Math.floor(Date.now() / 1000);

        // Track reflects per second
        if (currentSecond !== this.currentSecondReflectStart) {
            this.lastSecondReflects = this.reflectsThisSecond;
            this.peakReflectsPerSecond = Math.max(
                this.peakReflectsPerSecond,
                this.reflectsThisSecond,
            );
            this.reflectsThisSecond = 0;
            this.currentSecondReflectStart = currentSecond;
        }
        this.reflectsThisSecond++;

        // Record metrics
        this.reflectCount++;
        this.reflectDeliveredCount += delivered;
        if (acknowledged) {
            this.reflectAcknowledgedCount++;
        }
        // Track failed deliveries (delivered == 0 could indicate failure)
        if (delivered === 0) {
            this.failedReflectDeliveries++;
        }

        this.totalReflectTime += durationMs;
        this.totalReflectMessageSize += messageSizeBytes;

        // Maintain circular buffers for percentile calculations
        if (this.reflectTimes.length >= this.MAX_SAMPLES) {
            this.reflectTimes.shift();
            this.reflectMessageSizes.shift();
        }

        this.reflectTimes.push(durationMs);
        this.reflectMessageSizes.push(messageSizeBytes);
    }

    private calculatePercentile(values: number[], percentile: number): number {
        if (values.length === 0) return 0;
        const sorted = [...values].sort((a, b) => a - b);
        const index = Math.ceil((percentile / 100) * sorted.length) - 1;
        return sorted[Math.max(0, index)];
    }

    private createSystemMetrics(values: number[]): Service.API.I_SystemMetrics {
        const current = values.length > 0 ? values[values.length - 1] : 0;
        const average =
            values.length > 0
                ? values.reduce((a, b) => a + b, 0) / values.length
                : 0;
        const p99 = this.calculatePercentile(values, 99);
        const p999 = this.calculatePercentile(values, 99.9);

        return {
            current,
            average,
            p99,
            p999,
        };
    }

    getSystemMetrics(dbConnected: boolean) {
        const connectionSuccessRate =
            this.totalConnections > 0
                ? ((this.totalConnections - this.failedConnections) /
                      this.totalConnections) *
                  100
                : 100;

        return {
            connections: {
                active: this.createSystemMetrics(this.connectionCounts),
                total: this.totalConnections,
                failed: this.failedConnections,
                successRate: connectionSuccessRate,
            },
            database: {
                connected: dbConnected,
                connections: this.createSystemMetrics(this.dbConnectionCounts),
            },
            memory: {
                heapUsed: this.createSystemMetrics(this.memoryHeapUsed),
                heapTotal: this.createSystemMetrics(this.memoryHeapTotal),
                external: this.createSystemMetrics(this.memoryExternal),
                rss: this.createSystemMetrics(this.memoryRss),
            },
            cpu: {
                user: this.createSystemMetrics(this.cpuUserTimes),
                system: this.createSystemMetrics(this.cpuSystemTimes),
            },
        };
    }

    getMetrics(): Service.API.I_QueryMetrics {
        const averageQueryTime =
            this.queryCount > 0 ? this.totalQueryTime / this.queryCount : 0;
        const averageRequestSize =
            this.queryCount > 0 ? this.totalRequestSize / this.queryCount : 0;
        const averageResponseSize =
            this.queryCount > 0 ? this.totalResponseSize / this.queryCount : 0;
        const successRate =
            this.queryCount > 0
                ? ((this.queryCount - this.failedQueryCount) /
                      this.queryCount) *
                  100
                : 100;

        const uptimeSeconds = (Date.now() - this.startTime) / 1000;

        return {
            queriesPerSecond: {
                current: this.lastSecondQueries,
                average:
                    this.queryCount > 0 && uptimeSeconds > 0
                        ? this.queryCount / uptimeSeconds
                        : 0,
                peak: this.peakQueriesPerSecond,
            },
            queryCompletionTime: {
                averageMs: averageQueryTime,
                p99Ms: this.calculatePercentile(this.queryTimes, 99),
                p999Ms: this.calculatePercentile(this.queryTimes, 99.9),
            },
            requestSize: {
                averageKB: averageRequestSize / 1024,
                p99KB: this.calculatePercentile(this.requestSizes, 99) / 1024,
                p999KB:
                    this.calculatePercentile(this.requestSizes, 99.9) / 1024,
            },
            responseSize: {
                averageKB: averageResponseSize / 1024,
                p99KB: this.calculatePercentile(this.responseSizes, 99) / 1024,
                p999KB:
                    this.calculatePercentile(this.responseSizes, 99.9) / 1024,
            },
            totalQueries: this.queryCount,
            failedQueries: this.failedQueryCount,
            successRate,
        };
    }

    getReflectMetrics(): Service.API.I_ReflectMetrics {
        const averageReflectTime =
            this.reflectCount > 0
                ? this.totalReflectTime / this.reflectCount
                : 0;
        const averageMessageSize =
            this.reflectCount > 0
                ? this.totalReflectMessageSize / this.reflectCount
                : 0;
        const successRate =
            this.reflectCount > 0
                ? ((this.reflectCount - this.failedReflectDeliveries) /
                      this.reflectCount) *
                  100
                : 100;

        const uptimeSeconds = (Date.now() - this.startTime) / 1000;

        return {
            messagesPerSecond: {
                current: this.lastSecondReflects,
                average:
                    this.reflectCount > 0 && uptimeSeconds > 0
                        ? this.reflectCount / uptimeSeconds
                        : 0,
                peak: this.peakReflectsPerSecond,
            },
            messageDeliveryTime: {
                averageMs: averageReflectTime,
                p99Ms: this.calculatePercentile(this.reflectTimes, 99),
                p999Ms: this.calculatePercentile(this.reflectTimes, 99.9),
            },
            messageSize: {
                averageKB: averageMessageSize / 1024,
                p99KB:
                    this.calculatePercentile(this.reflectMessageSizes, 99) /
                    1024,
                p999KB:
                    this.calculatePercentile(this.reflectMessageSizes, 99.9) /
                    1024,
            },
            totalPublished: this.reflectCount,
            totalDelivered: this.reflectDeliveredCount,
            totalAcknowledged: this.reflectAcknowledgedCount,
            failedDeliveries: this.failedReflectDeliveries,
            successRate,
        };
    }

    reset() {
        this.queryTimes = [];
        this.requestSizes = [];
        this.responseSizes = [];
        this.queryCount = 0;
        this.failedQueryCount = 0;
        this.lastSecondQueries = 0;
        this.currentSecondStart = Math.floor(Date.now() / 1000);
        this.queriesThisSecond = 0;
        this.peakQueriesPerSecond = 0;
        this.totalQueryTime = 0;
        this.totalRequestSize = 0;
        this.totalResponseSize = 0;

        // Reset reflect metrics
        this.reflectTimes = [];
        this.reflectMessageSizes = [];
        this.reflectCount = 0;
        this.reflectDeliveredCount = 0;
        this.reflectAcknowledgedCount = 0;
        this.failedReflectDeliveries = 0;
        this.lastSecondReflects = 0;
        this.currentSecondReflectStart = Math.floor(Date.now() / 1000);
        this.reflectsThisSecond = 0;
        this.peakReflectsPerSecond = 0;
        this.totalReflectTime = 0;
        this.totalReflectMessageSize = 0;

        this.startTime = Date.now();

        // Reset system metrics
        this.cpuUserTimes = [];
        this.cpuSystemTimes = [];
        this.memoryHeapUsed = [];
        this.memoryHeapTotal = [];
        this.memoryExternal = [];
        this.memoryRss = [];
        this.connectionCounts = [];
        this.dbConnectionCounts = [];
        this.totalConnections = 0;
        this.failedConnections = 0;
    }
}
