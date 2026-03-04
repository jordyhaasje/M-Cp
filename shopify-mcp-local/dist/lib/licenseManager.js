const LICENSE_STATUSES = new Set(["active", "past_due", "canceled", "invalid", "unpaid"]);

function parseDate(value) {
    if (!value) {
        return null;
    }
    const ms = Date.parse(value);
    if (Number.isNaN(ms)) {
        return null;
    }
    return new Date(ms).toISOString();
}

function toMs(isoDate) {
    if (!isoDate) {
        return null;
    }
    const ms = Date.parse(isoDate);
    return Number.isNaN(ms) ? null : ms;
}

function nowIso() {
    return new Date().toISOString();
}

export class LicenseManager {
    constructor(config) {
        this.config = config;
        this.state = {
            status: "invalid",
            entitlements: {},
            expiresAt: null,
            graceUntil: null,
            readOnlyGraceUntil: null,
            lastValidationAt: null,
            lastError: null,
            source: "bootstrap",
        };
        this.heartbeatTimer = null;
        this.lastSuccessfulSyncAt = 0;
    }
    async initialize() {
        await this.validate("startup");
        const startupAccess = this.evaluateAccess({ toolName: "bootstrap", mutating: false });
        if (!startupAccess.allowed) {
            throw new Error(startupAccess.reason);
        }
        this.scheduleHeartbeat();
    }
    async destroy() {
        if (this.heartbeatTimer) {
            clearTimeout(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        await this.deactivate("shutdown");
    }
    async assertToolAllowed(toolName, options = {}) {
        const decision = this.evaluateAccess({
            toolName,
            mutating: !!options.mutating,
        });
        if (!decision.allowed) {
            throw new Error(`License gate blocked '${toolName}': ${decision.reason}`);
        }
        return decision;
    }
    getStatus() {
        const evaluatedRead = this.evaluateAccess({
            toolName: "status-read-check",
            mutating: false,
        });
        const evaluatedWrite = this.evaluateAccess({
            toolName: "status-write-check",
            mutating: true,
        });
        return {
            ...this.state,
            connection: {
                lastSuccessfulSyncAt: this.lastSuccessfulSyncAt
                    ? new Date(this.lastSuccessfulSyncAt).toISOString()
                    : null,
                heartbeatHours: this.config.heartbeatHours,
                graceHours: this.config.graceHours,
            },
            access: {
                read: evaluatedRead.allowed,
                write: evaluatedWrite.allowed,
                readReason: evaluatedRead.reason,
                writeReason: evaluatedWrite.reason,
            },
        };
    }
    async validate(source = "manual") {
        const payload = this.buildPayload();
        const data = await this.postJson("/v1/license/validate", payload);
        this.applyRemoteState(data, source);
        return this.state;
    }
    async deactivate(source = "manual") {
        try {
            await this.postJson("/v1/license/deactivate", this.buildPayload());
            this.state.source = source;
        }
        catch {
            // Best effort only.
        }
    }
    scheduleHeartbeat() {
        const intervalMs = this.config.heartbeatHours * 60 * 60 * 1000;
        const safeInterval = Math.max(intervalMs, 60000);
        this.heartbeatTimer = setTimeout(async () => {
            try {
                const data = await this.postJson("/v1/license/heartbeat", this.buildPayload());
                this.applyRemoteState(data, "heartbeat");
            }
            catch (error) {
                this.state.lastError = error instanceof Error ? error.message : String(error);
                this.state.source = "heartbeat-error";
            }
            finally {
                this.scheduleHeartbeat();
            }
        }, safeInterval);
        if (this.heartbeatTimer && typeof this.heartbeatTimer === "object" && "unref" in this.heartbeatTimer) {
            this.heartbeatTimer.unref();
        }
    }
    buildPayload() {
        return {
            licenseKey: this.config.licenseKey,
            mcpVersion: this.config.mcpVersion,
            machineFingerprint: this.config.machineFingerprint,
            timestamp: nowIso(),
        };
    }
    async postJson(path, payload) {
        const url = `${this.config.apiBaseUrl}${path}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
        try {
            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
                body: JSON.stringify(payload),
                signal: controller.signal,
            });
            const text = await response.text();
            let data = {};
            if (text) {
                try {
                    data = JSON.parse(text);
                }
                catch {
                    throw new Error(`License API returned non-JSON response (${response.status})`);
                }
            }
            if (!response.ok) {
                const reason = typeof data.message === "string" ? data.message : `HTTP ${response.status}`;
                throw new Error(`License API error: ${reason}`);
            }
            return data;
        }
        finally {
            clearTimeout(timeout);
        }
    }
    applyRemoteState(remote, source) {
        const status = typeof remote.status === "string" && LICENSE_STATUSES.has(remote.status)
            ? remote.status
            : "invalid";
        const now = Date.now();
        this.state = {
            status,
            entitlements: remote.entitlements && typeof remote.entitlements === "object" ? remote.entitlements : {},
            expiresAt: parseDate(remote.expiresAt),
            graceUntil: parseDate(remote.graceUntil),
            readOnlyGraceUntil: parseDate(remote.readOnlyGraceUntil),
            lastValidationAt: nowIso(),
            lastError: null,
            source,
        };
        this.lastSuccessfulSyncAt = now;
    }
    evaluateAccess(input) {
        const { toolName, mutating } = input;
        if (toolName === "get-license-status") {
            return { allowed: true, reason: "diagnostic tool always allowed" };
        }
        const now = Date.now();
        if (!this.lastSuccessfulSyncAt) {
            return {
                allowed: false,
                reason: "No successful license validation available",
            };
        }
        const heartbeatAgeMs = now - this.lastSuccessfulSyncAt;
        const heartbeatGraceMs = this.config.graceHours * 60 * 60 * 1000;
        if (heartbeatAgeMs > heartbeatGraceMs) {
            return {
                allowed: false,
                reason: "License heartbeat grace expired; revalidation required",
            };
        }
        const entitlements = this.state.entitlements || {};
        if (entitlements.tools && typeof entitlements.tools === "object" && entitlements.tools[toolName] === false) {
            return {
                allowed: false,
                reason: `Tool '${toolName}' is disabled by license entitlements`,
            };
        }
        if (mutating && entitlements.mutations === false) {
            return {
                allowed: false,
                reason: "Mutation tools disabled by license entitlements",
            };
        }
        const status = this.state.status;
        if (status === "active") {
            return { allowed: true, reason: "active" };
        }
        if (status === "past_due") {
            const graceUntilMs = toMs(this.state.graceUntil);
            if (graceUntilMs && now <= graceUntilMs) {
                return {
                    allowed: true,
                    reason: "past_due within grace window",
                };
            }
            if (mutating) {
                return {
                    allowed: false,
                    reason: "past_due grace expired for mutation tools",
                };
            }
            return {
                allowed: true,
                reason: "past_due grace expired; read-only access retained",
            };
        }
        if (status === "canceled" || status === "unpaid") {
            const readOnlyUntilMs = toMs(this.state.readOnlyGraceUntil);
            if (readOnlyUntilMs && now <= readOnlyUntilMs && !mutating) {
                return {
                    allowed: true,
                    reason: "canceled/unpaid read-only grace active",
                };
            }
            return {
                allowed: false,
                reason: "canceled/unpaid license blocks this operation",
            };
        }
        return {
            allowed: false,
            reason: "invalid license status",
        };
    }
}
