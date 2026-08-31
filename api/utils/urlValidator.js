/**
 * TeleShort v2.1 — URL Safety Validation & Normalization Engine
 * Protects against SSRF, internal network probing, dangerous URI schemes,
 * embedded credentials, and malformed destination URLs.
 */

// Private IP Range Patterns (IPv4)
const PRIVATE_IPV4_REGEX = [
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,          // 127.0.0.0/8 (Loopback)
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,           // 10.0.0.0/8 (Private)
  /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/, // 172.16.0.0/12 (Private)
  /^192\.168\.\d{1,3}\.\d{1,3}$/,             // 192.168.0.0/16 (Private)
  /^169\.254\.\d{1,3}\.\d{1,3}$/,             // 169.254.0.0/16 (Link-Local / AWS Metadata 169.254.169.254)
  /^0\.0\.0\.0$/,                              // 0.0.0.0
  /^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\.\d{1,3}\.\d{1,3}$/ // 100.64.0.0/10 (CGNAT)
];

// Blocked hostnames and TLDs
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'local',
  'broadcasthost',
  'metadata.google.internal',
  'instance-data'
]);

/**
 * Validate a destination URL for security compliance
 * @param {string} rawUrl - Input URL string
 * @param {object} options - Optional blocklist/allowlist overrides
 * @returns {{ valid: boolean, normalizedUrl?: string, error?: string }}
 */
function validateUrl(rawUrl, options = {}) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { valid: false, error: 'URL must be a non-empty string' };
  }

  const trimmed = rawUrl.trim();
  if (trimmed.length > 2048) {
    return { valid: false, error: 'URL exceeds maximum length of 2048 characters' };
  }

  // Reject dangerous schemes explicitly before URL parsing
  const lowerTrimmed = trimmed.toLowerCase();
  if (
    lowerTrimmed.startsWith('javascript:') ||
    lowerTrimmed.startsWith('data:') ||
    lowerTrimmed.startsWith('file:') ||
    lowerTrimmed.startsWith('vbscript:') ||
    lowerTrimmed.startsWith('blob:') ||
    lowerTrimmed.startsWith('about:')
  ) {
    return { valid: false, error: 'Dangerous URI scheme detected. Only HTTP and HTTPS are permitted.' };
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (e) {
    return { valid: false, error: 'Malformed URL syntax' };
  }

  // Protocol Check: Only http and https allowed
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, error: `Unsupported protocol "${parsed.protocol}". Only http: and https: are allowed.` };
  }

  // Credentials Check: Reject URLs with embedded auth (e.g., https://user:pass@host)
  if (parsed.username || parsed.password) {
    return { valid: false, error: 'URLs with embedded credentials (user:pass) are not allowed' };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Hostname Check: Ensure valid non-empty hostname
  if (!hostname || hostname.length === 0) {
    return { valid: false, error: 'Invalid or missing hostname in URL' };
  }

  // Blocked Hostnames Check
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    return { valid: false, error: 'Internal and localhost hostnames are prohibited' };
  }

  // Private IPv4 Check
  for (const regex of PRIVATE_IPV4_REGEX) {
    if (regex.test(hostname)) {
      return { valid: false, error: 'Private and internal IP address destinations are prohibited' };
    }
  }

  // IPv6 Check: Reject IPv6 loopback, link-local, and unique-local addresses
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    const rawIpv6 = hostname.slice(1, -1).toLowerCase();
    if (
      rawIpv6 === '::1' ||
      rawIpv6 === '0:0:0:0:0:0:0:1' ||
      rawIpv6.startsWith('fe80:') ||
      rawIpv6.startsWith('fc') ||
      rawIpv6.startsWith('fd')
    ) {
      return { valid: false, error: 'Private and internal IPv6 destinations are prohibited' };
    }
  }

  // Custom Domain Blocklist Check (if provided in options or config)
  if (options.blocklist && Array.isArray(options.blocklist)) {
    if (options.blocklist.some(domain => hostname === domain.toLowerCase() || hostname.endsWith(`.${domain.toLowerCase()}`))) {
      return { valid: false, error: 'The destination domain is blocked by platform policy' };
    }
  }

  // Normalize URL
  // Strip default ports (:80 for http, :443 for https)
  if ((parsed.protocol === 'http:' && parsed.port === '80') || (parsed.protocol === 'https:' && parsed.port === '443')) {
    parsed.port = '';
  }

  const normalizedUrl = parsed.toString();

  return {
    valid: true,
    normalizedUrl,
    hostname,
    protocol: parsed.protocol
  };
}

/**
 * Extensible URL Reputation Scanner Interface (Future Plugin Hook)
 * Integrates with Google Safe Browsing / VirusTotal APIs without SSRF risk
 */
class UrlReputationScanner {
  constructor(apiKey = null) {
    this.apiKey = apiKey;
  }

  async scanUrl(url) {
    // Interface stub for future Google Safe Browsing / VirusTotal integration
    return {
      safe: true,
      provider: 'built_in_rules',
      scannedAt: new Date().toISOString()
    };
  }
}

module.exports = {
  validateUrl,
  UrlReputationScanner
};
