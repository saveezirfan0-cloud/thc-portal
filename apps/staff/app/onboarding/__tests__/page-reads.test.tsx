import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Go-live audit M5 · the onboarding screens read in waves, not one read
 * after another.
 *
 *   /onboarding/[step]  onboarding_state() → (photo signature, the one
 *                       own-row staff select, step 6's questions)
 *                       It was up to five serial stages, with three
 *                       one-row selects of the same row.
 *   /onboarding         (onboarding_state(), staff_me()) → (photo
 *                       signature, the share-code check). A worker passing
 *                       through to their step waits for nothing after
 *                       the first wave; a locked worker's documents are
 *                       never read.
 *
 * Every loader is mocked with a promise the test settles, so "started
 * together" means: the second was called before the first had answered.
 */

class Redirect extends Error {
  constructor(public to: string) {
    super(`redirect ${to}`);
  }
}

const h = vi.hoisted(() => {
  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
  }
  return {
    deferred,
    access: { value: 'current' as string },
    phase: { value: 'in_progress' as string },
    lock: { value: 'none' as string },
    shareDoc: { value: null as null | { id: string; status: string } },
    loadOnboarding: vi.fn(),
    loadProfile: vi.fn(),
    loadOwnStaffFacts: vi.fn(),
    loadQuizQuestions: vi.fn(),
    signOwnPhoto: vi.fn(),
    loadMyRtwChecks: vi.fn(),
  };
});

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Redirect(to);
  },
  notFound: () => {
    throw new Redirect('404');
  },
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));
vi.mock('@thc/domain', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  stepAccess: () => h.access.value,
  canEditStep: () => false,
  wizardPhase: () => h.phase.value,
  currentStep: () => 3,
}));
vi.mock('../state', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  wizardFacts: () => ({ status: 'documents' }),
  requirementRows: () => [],
  completionLetterDoc: () => null,
  shareCodeDoc: () => h.shareDoc.value,
}));
vi.mock('../data', () => ({
  supabaseConfigured: () => true,
  loadOnboarding: h.loadOnboarding,
  loadOwnStaffFacts: h.loadOwnStaffFacts,
  loadQuizQuestions: h.loadQuizQuestions,
}));
vi.mock('../../profile/data', () => ({ loadProfile: h.loadProfile }));
vi.mock('../../profile/lock', () => ({ appLock: () => h.lock.value }));
vi.mock('../../profile/photos', () => ({ signOwnPhoto: h.signOwnPhoto }));
vi.mock('../../_lib/rtwCheck', () => ({ loadMyRtwChecks: h.loadMyRtwChecks }));

const { default: StepPage } = await import('../[step]/page');
const { default: IndexPage } = await import('../page');

const STATE = {
  staffId: 's1',
  firstName: 'Amara',
  lastName: 'Kalu',
  photoPath: 's1/selfie-1.jpg',
  progress: {},
  quiz: [],
  references: [],
  hmrc: null,
  bank: null,
  contract: null,
  homeAddress: null,
  status: 'documents',
};

/** Let every settled promise's continuation run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Find a prop on the first element in the tree that carries it. */
function findProp(node: unknown, prop: string): unknown {
  if (!node || typeof node !== 'object') return undefined;
  const props = (node as { props?: Record<string, unknown> }).props;
  if (!props) return undefined;
  if (prop in props) return props[prop];
  const children = props['children'];
  for (const child of Array.isArray(children) ? children : [children]) {
    const hit = findProp(child, prop);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

beforeEach(() => {
  for (const fn of [
    h.loadOnboarding,
    h.loadProfile,
    h.loadOwnStaffFacts,
    h.loadQuizQuestions,
    h.signOwnPhoto,
    h.loadMyRtwChecks,
  ]) {
    fn.mockReset();
  }
  h.access.value = 'current';
  h.phase.value = 'in_progress';
  h.lock.value = 'none';
  h.shareDoc.value = null;
  h.loadOnboarding.mockResolvedValue(STATE);
  h.loadProfile.mockResolvedValue({ leftAt: null });
  h.signOwnPhoto.mockResolvedValue('https://abc.supabase.co/sign/photos/s1/selfie-1.jpg');
  h.loadOwnStaffFacts.mockResolvedValue({
    gender: 'F',
    languages: ['English', 'Yoruba'],
    onboardingOnly: true,
  });
  h.loadQuizQuestions.mockResolvedValue([]);
  h.loadMyRtwChecks.mockResolvedValue({});
});

const step = (n: number) => StepPage({ params: Promise.resolve({ step: String(n) }) });

describe('/onboarding/[step]', () => {
  it('signs the photo and reads the own staff row together, once the state is in', async () => {
    const sign = h.deferred<string | null>();
    h.signOwnPhoto.mockReturnValue(sign.promise);
    const page = step(2);
    await flush();
    // Both started while the signature is still out.
    expect(h.signOwnPhoto).toHaveBeenCalledWith('s1/selfie-1.jpg');
    expect(h.loadOwnStaffFacts).toHaveBeenCalledWith('s1');
    sign.resolve(null);
    const tree = await page;
    expect(findProp(tree, 'onboardingOnly')).toBe(true);
    expect(findProp(tree, 'languages')).toEqual(['English', 'Yoruba']);
  });

  it('reads the staff row ONCE for the banner and step 7’s gender', async () => {
    const tree = await step(7);
    expect(h.loadOwnStaffFacts).toHaveBeenCalledTimes(1);
    expect((findProp(tree, 'initial') as { gender: string }).gender).toBe('F');
  });

  it('asks for the quiz questions on step 6 only, in the same wave', async () => {
    const sign = h.deferred<string | null>();
    h.signOwnPhoto.mockReturnValue(sign.promise);
    const page = step(6);
    await flush();
    expect(h.loadQuizQuestions).toHaveBeenCalledTimes(1);
    sign.resolve(null);
    await page;
    await step(5);
    expect(h.loadQuizQuestions).toHaveBeenCalledTimes(1);
  });

  it('sends a step that is not open back to /onboarding before reading anything else', async () => {
    h.access.value = 'locked';
    await expect(step(7)).rejects.toThrow(/redirect \/onboarding$/);
    expect(h.signOwnPhoto).not.toHaveBeenCalled();
    expect(h.loadOwnStaffFacts).not.toHaveBeenCalled();
  });
});

describe('/onboarding', () => {
  it('sends a worker on to their step after the first wave, with no signature', async () => {
    await expect(IndexPage()).rejects.toThrow(/redirect \/onboarding\/3/);
    expect(h.signOwnPhoto).not.toHaveBeenCalled();
    expect(h.loadMyRtwChecks).not.toHaveBeenCalled();
  });

  it('sends a finished worker to /shifts with no signature', async () => {
    h.phase.value = 'complete';
    await expect(IndexPage()).rejects.toThrow(/redirect \/shifts/);
    expect(h.signOwnPhoto).not.toHaveBeenCalled();
  });

  it('reads the share-code check alongside the signature while the office reviews', async () => {
    h.phase.value = 'awaiting_review';
    h.shareDoc.value = { id: 'd1', status: 'pending' };
    const sign = h.deferred<string | null>();
    h.signOwnPhoto.mockReturnValue(sign.promise);
    const page = IndexPage();
    await flush();
    expect(h.loadMyRtwChecks).toHaveBeenCalledTimes(1);
    sign.resolve(null);
    await page;
  });

  it.each(['hold', 'quiz_failed', 'leaver'])(
    'shows the %s lock and never reads that worker’s documents',
    async (lock) => {
      h.lock.value = lock;
      h.phase.value = 'awaiting_review';
      h.shareDoc.value = { id: 'd1', status: 'pending' };
      const tree = await IndexPage();
      expect(findProp(tree, 'lock')).toBe(lock);
      expect(h.loadMyRtwChecks).not.toHaveBeenCalled();
    },
  );
});
