import crypto from "crypto";
import os from "os";

function safeUserName() {
    try {
        return os.userInfo().username || "unknown";
    }
    catch {
        return process.env.USER || process.env.USERNAME || "unknown";
    }
}

export function createMachineFingerprint() {
    const raw = [
        os.hostname() || "unknown-host",
        os.platform(),
        os.arch(),
        process.version,
        safeUserName(),
    ].join("|");
    return crypto.createHash("sha256").update(raw).digest("hex");
}
