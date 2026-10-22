export function providerUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value.trim().replace(/\/+$/, ''));
  } catch {
    throw new Error('Enter a valid base URL.');
  }
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('Use an HTTP(S) base URL without credentials, query, or fragment.');
  }
  return url;
}
export function publicWebUrl(value: string): URL {
  const url = providerUrl(value);
  const host = url.hostname.toLowerCase();
  // Research tools only accept public DNS HTTPS names. Explicit model endpoints may be local.
  if (
    url.protocol !== 'https:' ||
    (url.port && url.port !== '443') ||
    !host.includes('.') ||
    /^[\d.]+$/.test(host) ||
    host.includes(':') ||
    /\.(local|localhost|internal|test|invalid|home|lan)$/.test(host) ||
    host === 'localhost' ||
    host.endsWith('.localhost')
  ) {
    throw new Error('Research tools require a public HTTPS address.');
  }
  return url;
}
export function researchUrl(value: string): URL {
  // Unlike provider URLs, article addresses may include query parameters.
  const url = new URL(value);
  if (url.username || url.password) throw new Error('URLs with credentials are not allowed.');
  publicWebUrl(url.origin);
  url.hash = '';
  return url;
}
export function xPostUrl(value: string): string {
  const url = new URL(value);
  if (
    !['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(url.hostname) ||
    url.protocol !== 'https:' ||
    !/^\/[A-Za-z0-9_]+\/status\/\d+\/?$/.test(url.pathname)
  ) {
    throw new Error('Invalid X post URL.');
  }
  return `https://x.com${url.pathname.replace(/\/$/, '')}`;
}
export function originPattern(value: string): string {
  return `${providerUrl(value).origin}/*`;
}
