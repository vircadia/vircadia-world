// =============================================================================
// ============================== IMPORTS, TYPES, AND INTERFACES ==============================
// =============================================================================

// =================================================================================
// ================ METRICS COLLECTOR: Efficient Query Performance Tracking ==================
// =================================================================================

interface SystemMetrics {
    current: number;
    average: number;
    p99: number;
    p999: number;
}

export class MetricsCollector {
    // System metrics only for REST Inference service
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

    // Inference-specific metrics
    private inferenceRequests: number[] = [];
    private inferenceSuccessCount = 0;
    private inferenceFailureCount = 0;
    private llmProcessingTimes: number[] = [];
    private llmTokensPerSecond: number[] = [];
    private sttProcessingTimes: number[] = [];
    private ttsProcessingTimes: number[] = [];

    private readonly MAX_SAMPLES = 1000;

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
        this.totalConnections++;
        if (!connectionSuccess) this.failedConnections++;

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
    recordEndpoint(
        _endpoint: string,
        durationMs: number,
        _requestSizeBytes: number,
        _responseSizeBytes: number,
        success: boolean,
    ) {
        this.inferenceRequests.push(durationMs);
        if (success) {
            this.inferenceSuccessCount++;
        } else {
            this.inferenceFailureCount++;
        }

        if (this.inferenceRequests.length >= this.MAX_SAMPLES) {
            this.inferenceRequests.shift();
        }
    }

    recordLLMMetrics(processingTimeMs: number, tokensPerSecond?: number) {
        this.llmProcessingTimes.push(processingTimeMs);
        if (tokensPerSecond !== undefined) {
            this.llmTokensPerSecond.push(tokensPerSecond);
        }

        if (this.llmProcessingTimes.length >= this.MAX_SAMPLES) {
            this.llmProcessingTimes.shift();
        }
        if (this.llmTokensPerSecond.length >= this.MAX_SAMPLES) {
            this.llmTokensPerSecond.shift();
        }
    }

    recordSTTMetrics(processingTimeMs: number) {
        this.sttProcessingTimes.push(processingTimeMs);
        if (this.sttProcessingTimes.length >= this.MAX_SAMPLES) {
            this.sttProcessingTimes.shift();
        }
    }

    recordTTSMetrics(processingTimeMs: number) {
        this.ttsProcessingTimes.push(processingTimeMs);
        if (this.ttsProcessingTimes.length >= this.MAX_SAMPLES) {
            this.ttsProcessingTimes.shift();
        }
    }

    getInferenceMetrics() {
        const successRate =
            this.inferenceSuccessCount + this.inferenceFailureCount > 0
                ? (this.inferenceSuccessCount /
                      (this.inferenceSuccessCount +
                          this.inferenceFailureCount)) *
                  100
                : 100;

        return {
            requests: {
                total: this.inferenceSuccessCount + this.inferenceFailureCount,
                successful: this.inferenceSuccessCount,
                failed: this.inferenceFailureCount,
                successRate,
                processingTime: this.createSystemMetrics(
                    this.inferenceRequests,
                ),
            },
            llm: {
                processingTime: this.createSystemMetrics(
                    this.llmProcessingTimes,
                ),
                tokensPerSecond: this.createSystemMetrics(
                    this.llmTokensPerSecond,
                ),
            },
            stt: {
                processingTime: this.createSystemMetrics(
                    this.sttProcessingTimes,
                ),
            },
            tts: {
                processingTime: this.createSystemMetrics(
                    this.ttsProcessingTimes,
                ),
            },
        };
    }

    reset() {
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
        this.inferenceRequests = [];
        this.inferenceSuccessCount = 0;
        this.inferenceFailureCount = 0;
        this.llmProcessingTimes = [];
        this.llmTokensPerSecond = [];
        this.sttProcessingTimes = [];
        this.ttsProcessingTimes = [];
    }
}
