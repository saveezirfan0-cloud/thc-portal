const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };
export const useRouter = () => router;
export const usePathname = () => globalThis.__pathname ?? '/';
export const useSearchParams = () => new URLSearchParams(globalThis.__search ?? '');
export const useParams = () => ({});
export const useSelectedLayoutSegment = () => null;
export function notFound() {
  throw new Error('notFound()');
}
export function redirect(u) {
  throw new Error('redirect(' + u + ')');
}
export const RedirectType = {};
