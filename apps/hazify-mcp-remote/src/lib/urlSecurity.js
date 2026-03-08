import dns from "dns/promises";
import net from "net";

const PRIVATE_IPV4_RANGES = [
    ["10.0.0.0", 8],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.168.0.0", 16],
    ["0.0.0.0", 8],
];

function ipv4ToInt(ip) {
    return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function isPrivateIPv4(ip) {
    const ipInt = ipv4ToInt(ip);
    for (const [base, prefix] of PRIVATE_IPV4_RANGES) {
        const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
        const baseInt = ipv4ToInt(base);
        if ((ipInt & mask) === (baseInt & mask)) {
            return true;
        }
    }
    return false;
}

function isPrivateIPv6(ip) {
    const normalized = ip.toLowerCase();
    if (normalized === "::1") {
        return true;
    }
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) {
        return true;
    }
    if (normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) {
        return true;
    }
    return normalized === "::";
}

export function assertPublicHttpsUrl(value) {
    let parsed;
    try {
        parsed = new URL(value);
    }
    catch {
        throw new Error("Invalid URL format");
    }
    if (parsed.protocol !== "https:") {
        throw new Error("Only https URLs are allowed");
    }
    if (parsed.username || parsed.password) {
        throw new Error("Credentials in URLs are not allowed");
    }
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === "localhost" || hostname.endsWith(".local")) {
        throw new Error("Local/internal hostnames are not allowed");
    }
    const ipType = net.isIP(hostname);
    if (ipType === 4 && isPrivateIPv4(hostname)) {
        throw new Error("Private/internal IPv4 addresses are not allowed");
    }
    if (ipType === 6 && isPrivateIPv6(hostname)) {
        throw new Error("Private/internal IPv6 addresses are not allowed");
    }
    return parsed;
}

async function assertHostResolvesPublic(hostname) {
    const results = await dns.lookup(hostname, { all: true });
    if (!results.length) {
        throw new Error("Hostname does not resolve");
    }
    for (const result of results) {
        if (result.family === 4 && isPrivateIPv4(result.address)) {
            throw new Error("Hostname resolves to private/internal IPv4");
        }
        if (result.family === 6 && isPrivateIPv6(result.address)) {
            throw new Error("Hostname resolves to private/internal IPv6");
        }
    }
}

export async function fetchWithSafeRedirects(inputUrl, options = {}) {
    const timeoutMs = typeof options.timeoutMs === "number" ? options.timeoutMs : 10000;
    const maxRedirects = typeof options.maxRedirects === "number" ? options.maxRedirects : 4;
    const headers = options.headers || {};
    let currentUrl = inputUrl;
    for (let i = 0; i <= maxRedirects; i++) {
        const parsed = assertPublicHttpsUrl(currentUrl);
        if (!net.isIP(parsed.hostname)) {
            await assertHostResolvesPublic(parsed.hostname);
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        let response;
        try {
            response = await fetch(parsed.toString(), {
                method: "GET",
                headers,
                redirect: "manual",
                signal: controller.signal,
            });
        }
        finally {
            clearTimeout(timeout);
        }
        const status = response.status;
        if (status >= 300 && status < 400) {
            const location = response.headers.get("location");
            if (!location) {
                throw new Error("Redirect response without location header");
            }
            currentUrl = new URL(location, parsed).toString();
            continue;
        }
        return response;
    }
    throw new Error("Too many redirects");
}
