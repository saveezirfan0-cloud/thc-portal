import type { MetadataRoute } from 'next';

/**
 * /robots.txt — the Client Portal is private (§11.1): every page is behind a
 * customer's sign-in, and nothing in it is for a search engine. The root
 * layout's `robots` metadata and next.config.ts's X-Robots-Tag say the same
 * to a crawler that does not read this file first.
 */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', disallow: '/' } };
}
