// A fake Supabase client: every query resolves to globalThis.__db[table] or [].
function builder(table) {
  const data = () => globalThis.__db?.[table] ?? [];
  const b = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then')
        return (res, rej) =>
          Promise.resolve({
            data: data(),
            error: null,
            count: Array.isArray(data()) ? data().length : 0,
          }).then(res, rej);
      if (prop === 'single' || prop === 'maybeSingle')
        return () =>
          Promise.resolve({
            data: Array.isArray(data()) ? (data()[0] ?? null) : data(),
            error: null,
          });
      return () => b;
    },
    apply() {
      return b;
    },
  });
  return b;
}
export function createClient() {
  return {
    from: (t) => builder(t),
    rpc: (t) => builder('rpc:' + t),
    auth: {
      getUser: async () => ({
        data: { user: { id: 'u1', email: 'sarah@thc.co.uk' } },
        error: null,
      }),
      getSession: async () => ({ data: { session: null } }),
    },
    storage: {
      from: () => ({
        createSignedUrls: async () => ({ data: [], error: null }),
        createSignedUrl: async () => ({ data: null, error: null }),
      }),
    },
  };
}
export const createAdminClient = createClient;
export const createServiceClient = createClient;
