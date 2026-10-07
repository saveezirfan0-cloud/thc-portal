import '../chrome.css';

/**
 * A header title that stops at two lines (ellipsis), with the whole text in
 * the `title` attribute. A shift's event and role name can run to five lines
 * on a phone and push the header down before it has collapsed on scroll.
 */
export function ClampTitle({ children }: { children: string }) {
  return (
    <span className="title-clamp" title={children}>
      {children}
    </span>
  );
}
