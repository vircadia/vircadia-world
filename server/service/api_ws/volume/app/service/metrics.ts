// =============================================================================
// ============================== IMPORTS, TYPES, AND INTERFACES ==============================
// =============================================================================

// Local metric interfaces to avoid coupling to schema package types
type SystemMetrics = { current: number; average: number; p99: number; p999: number };
type QueryMetrics = {
    queriesPerSecond: { current: number; average: number; peak: number };
    queryCompletionTime: { averageMs: number; p99Ms: number; p999Ms: number };
    requestSize: { averageKB: number; p99KB: number; p999KB: number };
    responseSize: { averageKB: number; p99KB: number; p999KB: number };
    totalQueries: number;
    failedQueries: number;
    successRate: number;
};
type ReflectMetrics = {
    messagesPerSecond: { current: number; average: number; peak: number };
    messageDeliveryTime: { averageMs: number; p99Ms: number; p999Ms: number };
    messageSize: { averageKB: number; p99KB: number; p999KB: number };
    totalPublished: number;
    totalDelivered: number;
    totalAcknowledged: number;
    failedDeliveries: number;
    successRate: number;
};
type EndpointMetrics = {
    requestsPerSecond: { current: number; average: number; peak: number };
    requestCompletionTime: { averageMs: number; p99Ms: number; p999Ms: number };
    requestSize: { averageKB: number; p99KB: number; p999KB: number };
    responseSize: { averageKB: number; p99KB: number; p999KB: number };
    totalRequests: number;
    failedRequests: number;
    successRate: number;
};
type EndpointStats = { [endpoint: string]: EndpointMetrics };

// Tick metrics exposed per sync group
type TickMetrics = {
    [syncGroup: string]: {
        ticksPerSecond: { current: number; average: number; peak: number };
        durationMs: { averageMs: number; p99Ms: number; p999Ms: number };
        messagesPerTick: { average: number; p99: number; p999: number };
        bytesPerTickKB: { averageKB: number; p99KB: number; p999KB: number };
        deliveredPerTick: { average: number; p99: number; p999: number };
        totalTicks: number;
        overruns: number;
        overrunRate: number;
        lastDurationMs: number;
        recentDurationsMs: number[];
    };
};

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
    private startTime = performance.now();

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

    // Endpoint-specific metrics tracking
    private endpointRequestTimes: Map<string, number[]> = new Map();
    private endpointRequestSizes: Map<string, number[]> = new Map();
    private endpointResponseSizes: Map<string, number[]> = new Map();
    private endpointRequestCounts: Map<string, number> = new Map();
    private endpointFailedCounts: Map<string, number> = new Map();
    private endpointPerSecond: Map<string, number> = new Map();
    private endpointPerSecondLast: Map<string, number> = new Map();
    private endpointPerSecondPeak: Map<string, number> = new Map();
    private endpointTotalTimes: Map<string, number> = new Map();
    private endpointTotalRequestSizes: Map<string, number> = new Map();
    private endpointTotalResponseSizes: Map<string, number> = new Map();

    // Tick (reflect flush) metrics per sync group
    private tickDurations: Map<string, number[]> = new Map();
    private tickMessageCounts: Map<string, number[]> = new Map();
    private tickDeliveredCounts: Map<string, number[]> = new Map();
    private tickBytes: Map<string, number[]> = new Map();
    private tickCounts: Map<string, number> = new Map();
    private tickOverruns: Map<string, number> = new Map();
    private tickLastDuration: Map<string, number> = new Map();
    private tickSecondStart: number = Math.floor(Date.now() / 1000);
    private tickCountsThisSecond: Map<string, number> = new Map();
    private tickLastSecond: Map<string, number> = new Map();
    private tickPeakPerSecond: Map<string, number> = new Map();

    // Activity tracking (pushers/subscribers) over a sliding time window
    private readonly MAX_ACTIVITY_WINDOW_SEC = 300; // cap at last 5 minutes
    private pusherActivityEvents: Array<{
        t: number;
        sessionId: string;
        syncGroup: string;
        channel: string;
    }> = [];
    private subscriberActivityEvents: Array<{
        t: number;
        sessionId: string;
        syncGroup: string;
        channel: string;
    }> = [];

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

    // ========================= Activity (Pushers/Subscribers) =========================
    private pruneActivity(nowMs: number) {
        const threshold = nowMs - this.MAX_ACTIVITY_WINDOW_SEC * 1000;

        // Pusher events
        let idx = 0;
        while (idx < this.pusherActivityEvents.length && this.pusherActivityEvents[idx].t < threshold) {
            idx++;
        }
        if (idx > 0) {
            this.pusherActivityEvents.splice(0, idx);
        }

        // Subscriber events
        idx = 0;
        while (idx < this.subscriberActivityEvents.length && this.subscriberActivityEvents[idx].t < threshold) {
            idx++;
        }
        if (idx > 0) {
            this.subscriberActivityEvents.splice(0, idx);
        }
    }

    recordPusher(sessionId: string, syncGroup: string, channel: string) {
        const now = Date.now();
        this.pruneActivity(now);
        this.pusherActivityEvents.push({ t: now, sessionId, syncGroup, channel });
    }

    recordSubscriberDelivery(sessionId: string, syncGroup: string, channel: string) {
        const now = Date.now();
        this.pruneActivity(now);
        this.subscriberActivityEvents.push({ t: now, sessionId, syncGroup, channel });
    }

    getActivityMetrics(windowSec: number = 60): {
        windowSec: number;
        pushers: {
            totalActiveSessions: number;
            totalActiveChannels: number;
            perSessionChannelCounts: Record<string, number>;
        };
        subscribers: {
            totalActiveSessions: number;
            totalActiveChannels: number;
            perSessionChannelCounts: Record<string, number>;
        };
    } {
        const clampedWindowSec = Math.max(1, Math.min(windowSec, this.MAX_ACTIVITY_WINDOW_SEC));
        const now = Date.now();
        const threshold = now - clampedWindowSec * 1000;

        // Helper to aggregate
        const aggregate = (events: Array<{ t: number; sessionId: string; syncGroup: string; channel: string }>) => {
            const sessionToChannelKeys: Map<string, Set<string>> = new Map();
            const allChannelKeys: Set<string> = new Set();

            for (let i = events.length - 1; i >= 0; i--) {
                const ev = events[i];
                if (ev.t < threshold) break;
                const channelKey = `${ev.syncGroup}:${ev.channel}`;
                allChannelKeys.add(channelKey);
                if (!sessionToChannelKeys.has(ev.sessionId)) {
                    sessionToChannelKeys.set(ev.sessionId, new Set());
                }
                sessionToChannelKeys.get(ev.sessionId)!.add(channelKey);
            }

            const perSessionChannelCounts: Record<string, number> = {};
            for (const [sessionId, set] of sessionToChannelKeys.entries()) {
                perSessionChannelCounts[sessionId] = set.size;
            }

            return {
                totalActiveSessions: sessionToChannelKeys.size,
                totalActiveChannels: allChannelKeys.size,
                perSessionChannelCounts,
            };
        };

        const pushers = aggregate(this.pusherActivityEvents);
        const subscribers = aggregate(this.subscriberActivityEvents);

        return { windowSec: clampedWindowSec, pushers, subscribers };
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

    recordEndpoint(
        endpoint: string,
        durationMs: number,
        requestSizeBytes: number,
        responseSizeBytes: number,
        success: boolean,
    ) {
        const currentSecond = Math.floor(Date.now() / 1000);

        // Track requests per second for this endpoint
        if (!this.endpointPerSecond.has(endpoint)) {
            this.endpointPerSecond.set(endpoint, 0);
            this.endpointPerSecondLast.set(endpoint, 0);
            this.endpointPerSecondPeak.set(endpoint, 0);
        }

        const endpointSecondKey = `${endpoint}-${currentSecond}`;
        const currentCount = this.endpointPerSecond.get(endpointSecondKey) || 0;
        this.endpointPerSecond.set(endpointSecondKey, currentCount + 1);

        // Update last second and peak values when second changes
        if (currentSecond !== Math.floor(Date.now() / 1000) - 1) {
            // Update last second and peak
            const lastSecondCount = this.endpointPerSecond.get(endpoint) || 0;
            this.endpointPerSecondLast.set(endpoint, lastSecondCount);
            this.endpointPerSecondPeak.set(endpoint, Math.max(
                this.endpointPerSecondPeak.get(endpoint) || 0,
                lastSecondCount
            ));
            this.endpointPerSecond.set(endpoint, 0);
        }

        // Record metrics for this endpoint
        const totalCount = this.endpointRequestCounts.get(endpoint) || 0;
        this.endpointRequestCounts.set(endpoint, totalCount + 1);

        if (!success) {
            const currentFailed = this.endpointFailedCounts.get(endpoint) || 0;
            this.endpointFailedCounts.set(endpoint, currentFailed + 1);
        }

        const currentTotalTime = this.endpointTotalTimes.get(endpoint) || 0;
        this.endpointTotalTimes.set(endpoint, currentTotalTime + durationMs);

        const currentTotalRequestSize = this.endpointTotalRequestSizes.get(endpoint) || 0;
        this.endpointTotalRequestSizes.set(endpoint, currentTotalRequestSize + requestSizeBytes);

        const currentTotalResponseSize = this.endpointTotalResponseSizes.get(endpoint) || 0;
        this.endpointTotalResponseSizes.set(endpoint, currentTotalResponseSize + responseSizeBytes);

        // Maintain circular buffers for percentile calculations
        const initArray = (map: Map<string, number[]>, key: string): number[] => {
            if (!map.has(key)) {
                map.set(key, []);
            }
            return map.get(key)!;
        };

        let times = initArray(this.endpointRequestTimes, endpoint);
        let requestSizes = initArray(this.endpointRequestSizes, endpoint);
        let responseSizes = initArray(this.endpointResponseSizes, endpoint);

        if (times.length >= this.MAX_SAMPLES) {
            times.shift();
            requestSizes.shift();
            responseSizes.shift();
        }

        times.push(durationMs);
        requestSizes.push(requestSizeBytes);
        responseSizes.push(responseSizeBytes);
    }

    // ========================= Tick (Reflect Flush) =========================
    recordTick(
        syncGroup: string,
        durationMs: number,
        totalMessages: number,
        totalBytes: number,
        deliveredCount: number,
        configuredRateMs: number,
    ) {
        const nowSecond = Math.floor(Date.now() / 1000);
        if (nowSecond !== this.tickSecondStart) {
            for (const [group, count] of this.tickCountsThisSecond.entries()) {
                this.tickLastSecond.set(group, count);
                const prevPeak = this.tickPeakPerSecond.get(group) || 0;
                if (count > prevPeak) this.tickPeakPerSecond.set(group, count);
                this.tickCountsThisSecond.set(group, 0);
            }
            this.tickSecondStart = nowSecond;
        }
        this.tickCountsThisSecond.set(
            syncGroup,
            (this.tickCountsThisSecond.get(syncGroup) || 0) + 1,
        );

        const initArray = (map: Map<string, number[]>, key: string): number[] => {
            if (!map.has(key)) map.set(key, []);
            return map.get(key)!;
        };

        const durations = initArray(this.tickDurations, syncGroup);
        const msgs = initArray(this.tickMessageCounts, syncGroup);
        const bytes = initArray(this.tickBytes, syncGroup);
        const delivered = initArray(this.tickDeliveredCounts, syncGroup);

        if (durations.length >= this.MAX_SAMPLES) durations.shift();
        if (msgs.length >= this.MAX_SAMPLES) msgs.shift();
        if (bytes.length >= this.MAX_SAMPLES) bytes.shift();
        if (delivered.length >= this.MAX_SAMPLES) delivered.shift();

        durations.push(durationMs);
        msgs.push(totalMessages);
        bytes.push(totalBytes);
        delivered.push(deliveredCount);

        this.tickCounts.set(syncGroup, (this.tickCounts.get(syncGroup) || 0) + 1);
        if (configuredRateMs > 0 && durationMs > configuredRateMs) {
            this.tickOverruns.set(
                syncGroup,
                (this.tickOverruns.get(syncGroup) || 0) + 1,
            );
        }
        this.tickLastDuration.set(syncGroup, durationMs);
    }

    getTickMetrics(): TickMetrics {
        const result: TickMetrics = {};
        const uptimeSeconds = (performance.now() - this.startTime) / 1000;
        const groups = new Set<string>([
            ...this.tickDurations.keys(),
            ...this.tickCounts.keys(),
        ]);

        const percentile = (values: number[], p: number): number =>
            this.calculatePercentile(values, p);

        for (const group of groups) {
            const durations = this.tickDurations.get(group) || [];
            const msgs = this.tickMessageCounts.get(group) || [];
            const bytes = this.tickBytes.get(group) || [];
            const delivered = this.tickDeliveredCounts.get(group) || [];
            const totalTicks = this.tickCounts.get(group) || 0;
            const overruns = this.tickOverruns.get(group) || 0;
            const last = this.tickLastDuration.get(group) || 0;
            const currentPerSecond = this.tickLastSecond.get(group) || 0;
            const peakPerSecond = this.tickPeakPerSecond.get(group) || 0;
            const averagePerSecond = totalTicks > 0 && uptimeSeconds > 0 ? totalTicks / uptimeSeconds : 0;

            const avg = (arr: number[]) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

            result[group] = {
                ticksPerSecond: {
                    current: currentPerSecond,
                    average: averagePerSecond,
                    peak: peakPerSecond,
                },
                durationMs: {
                    averageMs: avg(durations),
                    p99Ms: percentile(durations, 99),
                    p999Ms: percentile(durations, 99.9),
                },
                messagesPerTick: {
                    average: avg(msgs),
                    p99: percentile(msgs, 99),
                    p999: percentile(msgs, 99.9),
                },
                bytesPerTickKB: {
                    averageKB: avg(bytes) / 1024,
                    p99KB: percentile(bytes, 99) / 1024,
                    p999KB: percentile(bytes, 99.9) / 1024,
                },
                deliveredPerTick: {
                    average: avg(delivered),
                    p99: percentile(delivered, 99),
                    p999: percentile(delivered, 99.9),
                },
                totalTicks,
                overruns,
                overrunRate: totalTicks > 0 ? (overruns / totalTicks) * 100 : 0,
                lastDurationMs: last,
                recentDurationsMs: durations.slice(-20),
            };
        }

        return result;
    }

    private calculatePercentile(values: number[], percentile: number): number {
        if (values.length === 0) return 0;
        const sorted = [...values].sort((a, b) => a - b);
        const index = Math.ceil((percentile / 100) * sorted.length) - 1;
        return sorted[Math.max(0, index)];
    }

    private createSystemMetrics(values: number[]): SystemMetrics {
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

    getMetrics(): QueryMetrics {
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

        const uptimeSeconds = (performance.now() - this.startTime) / 1000;

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

    getReflectMetrics(): ReflectMetrics {
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

        const uptimeSeconds = (performance.now() - this.startTime) / 1000;

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

    getEndpointMetrics(): EndpointStats {
        const result: EndpointStats = {};
        const uptimeSeconds = (performance.now() - this.startTime) / 1000;

        for (const [endpoint, count] of this.endpointRequestCounts.entries()) {
            const times = this.endpointRequestTimes.get(endpoint) || [];
            const requestSizes = this.endpointRequestSizes.get(endpoint) || [];
            const responseSizes = this.endpointResponseSizes.get(endpoint) || [];

            const averageRequestTime = count > 0 ? (this.endpointTotalTimes.get(endpoint) || 0) / count : 0;
            const averageRequestSize = count > 0 ? (this.endpointTotalRequestSizes.get(endpoint) || 0) / count : 0;
            const averageResponseSize = count > 0 ? (this.endpointTotalResponseSizes.get(endpoint) || 0) / count : 0;
            const failedCount = this.endpointFailedCounts.get(endpoint) || 0;
            const successRate = count > 0 ? ((count - failedCount) / count) * 100 : 100;

            // Calculate current/second metrics
            const currentRequestsPerSecond = this.endpointPerSecondLast.get(endpoint) || 0;
            const averageRequestsPerSecond = count > 0 && uptimeSeconds > 0 ? count / uptimeSeconds : 0;
            const peakRequestsPerSecond = this.endpointPerSecondPeak.get(endpoint) || 0;

            result[endpoint] = {
                requestsPerSecond: {
                    current: currentRequestsPerSecond,
                    average: averageRequestsPerSecond,
                    peak: peakRequestsPerSecond,
                },
                requestCompletionTime: {
                    averageMs: averageRequestTime,
                    p99Ms: this.calculatePercentile(times, 99),
                    p999Ms: this.calculatePercentile(times, 99.9),
                },
                requestSize: {
                    averageKB: averageRequestSize / 1024,
                    p99KB: this.calculatePercentile(requestSizes, 99) / 1024,
                    p999KB: this.calculatePercentile(requestSizes, 99.9) / 1024,
                },
                responseSize: {
                    averageKB: averageResponseSize / 1024,
                    p99KB: this.calculatePercentile(responseSizes, 99) / 1024,
                    p999KB: this.calculatePercentile(responseSizes, 99.9) / 1024,
                },
                totalRequests: count,
                failedRequests: failedCount,
                successRate,
            };
        }

        return result;
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

        this.startTime = performance.now();

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

        // Reset endpoint metrics
        this.endpointRequestTimes.clear();
        this.endpointRequestSizes.clear();
        this.endpointResponseSizes.clear();
        this.endpointRequestCounts.clear();
        this.endpointFailedCounts.clear();
        this.endpointPerSecond.clear();
        this.endpointPerSecondLast.clear();
        this.endpointPerSecondPeak.clear();
        this.endpointTotalTimes.clear();
        this.endpointTotalRequestSizes.clear();
        this.endpointTotalResponseSizes.clear();

        // Reset tick metrics
        this.tickDurations.clear();
        this.tickMessageCounts.clear();
        this.tickDeliveredCounts.clear();
        this.tickBytes.clear();
        this.tickCounts.clear();
        this.tickOverruns.clear();
        this.tickLastDuration.clear();
        this.tickSecondStart = Math.floor(Date.now() / 1000);
        this.tickCountsThisSecond.clear();
        this.tickLastSecond.clear();
        this.tickPeakPerSecond.clear();
    }
}
