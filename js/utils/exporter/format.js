// js/utils/exporter/format.js
//
// Pure formatting/serialization helpers shared across the exporter layer.
// These functions are stateless and free of exporter singleton coupling.

export function nowIso() {
    return new Date().toISOString();
}

export function safeClone(value) {
    try {
        if (typeof structuredClone === "function") {
            return structuredClone(value);
        }
    } catch (_) { }

    try {
        return JSON.parse(JSON.stringify(value));
    } catch (_) {
        return null;
    }
}

export function hashString(input) {
    const str = String(input ?? "");
    let hash = 2166136261;

    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }

    return (hash >>> 0).toString(16).padStart(8, "0");
}

export function hashObject(value) {
    return hashString(JSON.stringify(value ?? null));
}

export function redactModelRoutes(models) {
    if (!models || typeof models !== "object") return {};

    return Object.fromEntries(
        Object.entries(models).map(([role, model]) => [
            role,
            typeof model === "string" ? model : safeClone(model)
        ])
    );
}

export function safeRatio(effective, reported) {
    const effectiveNumber = Number(effective);
    const reportedNumber = Number(reported);

    if (
        !Number.isFinite(effectiveNumber) ||
        !Number.isFinite(reportedNumber) ||
        reportedNumber === 0
    ) {
        return null;
    }

    return +(effectiveNumber / reportedNumber).toFixed(2);
}

export function finiteDifference(after, before) {
    const afterNumber = Number(after);
    const beforeNumber = Number(before);

    if (
        !Number.isFinite(afterNumber) ||
        !Number.isFinite(beforeNumber)
    ) {
        return 0;
    }

    return afterNumber - beforeNumber;
}

export function finiteOrDefault(value, fallback = 0) {
    const number = Number(value);

    return Number.isFinite(number)
        ? number
        : fallback;
}

export function finiteOrNull(value) {
    if (
        value === null ||
        value === undefined ||
        value === ""
    ) {
        return null;
    }

    const number = Number(value);

    return Number.isFinite(number)
        ? number
        : null;
}

export function asArray(value) {
    return Array.isArray(value)
        ? value
        : [];
}

export function joinList(value) {
    return asArray(value)
        .filter(
            (entry) =>
                entry !== null &&
                entry !== undefined &&
                entry !== ""
        )
        .map(String)
        .join(";");
}

export function slugify(value) {
    if (
        typeof value !== "string"
    ) {
        return "";
    }

    return value
        .trim()
        .toLowerCase()
        .replace(
            /[^a-z0-9]+/g,
            "_"
        )
        .replace(
            /^_+|_+$/g,
            ""
        );
}

export function cloneValue(value) {
    if (
        typeof structuredClone === "function"
    ) {
        try {
            return structuredClone(
                value
            );
        } catch (error) {
            console.warn(
                "[EXPORTER] structuredClone failed; using JSON clone",
                error
            );
        }
    }

    try {
        return JSON.parse(
            JSON.stringify(value)
        );
    } catch (error) {
        console.warn(
            "[EXPORTER] Could not clone value",
            error
        );

        return {};
    }
}
