export async function cookies() {
  return {
    get() {
      return undefined;
    },
    getAll() {
      return [];
    },
    set() {},
    delete() {},
    has() {
      return false;
    },
  };
}
export async function headers() {
  return new Headers({ host: 'localhost' });
}
export async function draftMode() {
  return { isEnabled: false };
}
