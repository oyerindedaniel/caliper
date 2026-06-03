const REDACTED = "[REDACTED]";
const TRUNCATED = "[TRUNCATED]";

const DEFAULT_MAX_FIELD_CHARS = 16_384;

/** Normalized key tokens that trigger full value redaction (Trailonix / autoredact / qibb conventions). */
const SENSITIVE_KEY_SEGMENTS = [
  "password",
  "passwd",
  "pwd",
  "passphrase",
  "secret",
  "credential",
  "token",
  "bearer",
  "authorization",
  "auth",
  "cookie",
  "sessionid",
  "sessionkey",
  "apikey",
  "accesskey",
  "privatekey",
  "clientsecret",
  "refreshtoken",
  "accesstoken",
  "idtoken",
  "setcookie",
  "proxyauthorization",
  "xapikey",
  "apisecret",
  "signingkey",
  "encryptionkey",
  "otp",
  "mfa",
  "totp",
  "ssn",
  "sin",
  "creditcard",
  "cardnumber",
  "cvv",
  "cvc",
  "cvv2",
  "pin",
  "pincode",
  "taxid",
  "ein",
  "iban",
  "routingnumber",
  "recoverycode",
  "licensekey",
  "connectionstring",
  "databaseurl",
  "jwt",
  "openid",
  "codeverifier",
  "codechallenge",
] as const;

const VALUE_REDACTION_PATTERNS: ReadonlyArray<{ pattern: RegExp; replacement: string }> = [
  { pattern: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, replacement: `Bearer ${REDACTED}` },
  { pattern: /Basic\s+[A-Za-z0-9+/]+=*/gi, replacement: `Basic ${REDACTED}` },
  {
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    replacement: "[JWT-REDACTED]",
  },
  { pattern: /\bsk_(live|test)_[A-Za-z0-9]{16,}\b/g, replacement: `sk_${REDACTED}` },
  { pattern: /\bpk_(live|test)_[A-Za-z0-9]{16,}\b/g, replacement: `pk_${REDACTED}` },
  { pattern: /\bghp_[A-Za-z0-9]{20,}\b/g, replacement: `ghp_${REDACTED}` },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, replacement: `github_pat_${REDACTED}` },
  { pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, replacement: `xox${REDACTED}` },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: "AKIA[REDACTED]" },
  { pattern: /\bASIA[0-9A-Z]{16}\b/g, replacement: "ASIA[REDACTED]" },
  {
    pattern: /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/g,
    replacement: "[PEM-PRIVATE-KEY-REDACTED]",
  },
  {
    pattern: /([?&])(token|password|passwd|pwd|secret|api_key|apikey|access_token|auth)=([^&\s#]+)/gi,
    replacement: `$1$2=${REDACTED}`,
  },
  {
    pattern: /:\/\/([^:@/]+):([^@/]+)@/g,
    replacement: `://$1:${REDACTED}@`,
  },
];

function normalizeKeyName(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKeyName(key);
  if (!normalized) {
    return false;
  }

  for (const segment of SENSITIVE_KEY_SEGMENTS) {
    if (normalized === segment || normalized.includes(segment)) {
      return true;
    }
  }

  return false;
}

function redactStringValue(value: string, maxChars: number): string {
  let output = value.length > maxChars ? `${value.slice(0, maxChars)}${TRUNCATED}` : value;

  for (const { pattern, replacement } of VALUE_REDACTION_PATTERNS) {
    output = output.replace(pattern, replacement);
  }

  return output;
}

function redactUnknown(
  value: unknown,
  maxChars: number,
  depth: number,
  maxDepth: number
): unknown {
  if (depth > maxDepth) {
    return "[MAX_DEPTH]";
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return redactStringValue(value, maxChars);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactUnknown(item, maxChars, depth + 1, maxDepth));
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(record)) {
      if (isSensitiveKey(key)) {
        output[key] = REDACTED;
        continue;
      }
      output[key] = redactUnknown(nested, maxChars, depth + 1, maxDepth);
    }
    return output;
  }

  return String(value);
}

export function isRuntimeRedactionEnabled(): boolean {
  const flag = process.env.CALIPER_RUNTIME_REDACT?.trim().toLowerCase();
  return flag !== "0" && flag !== "false" && flag !== "off";
}

export function redactRuntimeEntry(entry: unknown): unknown {
  if (!isRuntimeRedactionEnabled()) {
    return entry;
  }
  return redactUnknown(entry, DEFAULT_MAX_FIELD_CHARS, 0, 12);
}

export function redactRuntimeLine(line: string): string {
  if (!isRuntimeRedactionEnabled()) {
    return line;
  }

  try {
    const parsed = JSON.parse(line) as unknown;
    return `${JSON.stringify(redactRuntimeEntry(parsed))}\n`;
  } catch {
    return `${redactStringValue(line, DEFAULT_MAX_FIELD_CHARS)}\n`;
  }
}
