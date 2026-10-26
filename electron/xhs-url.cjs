function parseHttpsUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

function isHostOrSubdomain(hostname, root) {
  return hostname === root || hostname.endsWith("." + root);
}

function isXhsUrl(value) {
  const url = parseHttpsUrl(value);
  return Boolean(url && isHostOrSubdomain(url.hostname, "xiaohongshu.com"));
}

function noteIdFromUrl(value) {
  const url = parseHttpsUrl(value);
  if (!url || !isHostOrSubdomain(url.hostname, "xiaohongshu.com")) return null;
  const match = url.pathname.match(/^\/(?:explore|discovery\/item|search_result|search-result)\/([a-zA-Z0-9_-]{1,128})(?:\/|$)/);
  return match ? match[1] : null;
}

function isXhsImageUrl(value) {
  const url = parseHttpsUrl(value);
  return Boolean(url && (
    isHostOrSubdomain(url.hostname, "xhscdn.com") ||
    isHostOrSubdomain(url.hostname, "xiaohongshu.com")
  ));
}

module.exports = { isXhsUrl, noteIdFromUrl, isXhsImageUrl };
