import { createElement, forwardRef } from 'react';
const Link = forwardRef(function Link(
  { href, prefetch, replace, scroll, shallow, passHref, legacyBehavior, ...rest },
  ref,
) {
  const h =
    typeof href === 'string'
      ? href
      : (href?.pathname ?? '#') + (href?.query ? '?' + new URLSearchParams(href.query) : '');
  return createElement('a', { href: h, ref, ...rest });
});
export default Link;
