# ADR-0068 · A searchable dialling-code picker and a typed-or-picked date of birth on /apply

**Status:** Accepted. Supersedes ADR-0009's native `<select>`. Amends ADR-0008 only in how the date is entered: the stored value is still `yyyy-mm-dd`.

## Context

Owner feedback on the live `/apply` (28.09):

1. The country-code list was ~210 rows of flag + code. You couldn't search it, and the order (the wireframe's nine, then A → Z by a name you couldn't see) looked random. ADR-0009 had already listed this as the form's weakest part.
2. The date of birth was a native `<input type="date">`. On iOS you can't type into it, so you scroll a wheel back decades. On desktop the calendar icon was hidden behind the browser's autofill icon. The owner asked for "type or select digits, maybe calendar".

## Decision

**Country code: `DialCodePicker`** (`apps/staff/app/apply/DialCodePicker.tsx`, search in `dialSearch.ts`).

- **Closed:** it is still the wireframe's `🇬🇧 +44 ▾` control in the 118px slot.
- **Open:** a search box sits over a list. Each row shows flag · country name · code. With no search typed, the list is grouped under "Common" (the wireframe's nine) and "All countries A–Z".
- **What the search matches:**
  - the name, or the start of it
  - any word in the name
  - the initials (`uae`)
  - the two-letter ISO code, read from the flag (`de`, `gb`)
  - a short list of other common names (`uk`, `england`, `usa`, `holland`, `ivory coast`, …)
  - the digits of the code (`44`, `+44`, `0044`)

  Case, accents and apostrophes are ignored.
- **Accessibility:** it follows the ARIA combobox pattern. Focus stays in the search box, and ↑/↓/Home/End/Enter/Escape work as expected.
- **What is submitted:** still the dialling code, from a hidden `dialCode` input, so `actions.ts`, `toE164()` and `submit_application()` are unchanged.
- **Where it is used:** the emergency contact's phone uses the same picker (docs/19 §2, "the same international picker").

**Date of birth: `DobInput`** (`DobInput.tsx`, formatting in `dob.ts`).

- **Typing:** it is a text box with `inputMode="numeric"`, so phones show the number pad. It shows `DD/MM/YYYY` (UK order, §1.8) and adds the slashes as you type. A single-digit day or month followed by a slash is padded (`5/6/1998`), and autofill's `yyyy-mm-dd` is turned round the right way.
- **Calendar:** a calendar button is welded to the box's right. It is the browser's own date input, laid transparently over the icon, so a phone opens its OS wheel and a desktop its calendar. It sits outside the text box, where the autofill icon can't cover it.
- **Accessibility:** the typed box is the field (label, error, keyboard path). The calendar is a pointer shortcut, so it is kept out of the Tab order and hidden from screen readers.
- **What the form gets:** `yyyy-mm-dd` once the entry is complete, and the half-typed text otherwise. `validate()` and the database refuse both exactly as before. As before, there is no `max` (§1.7: under-18 is refused out loud, not hidden).

**Where they live:** both controls are in the Staff App next to the data they use (`DIAL_CODES`), not in `packages/ui`. If another app needs one, lifting it into `packages/ui` is a separate PR.

## Consequences

- The open list is new UI with no wireframe. The collapsed controls match `wireframes/public/apply.html`, apart from the calendar button welded to the date field.
- The ADR-0009 follow-up (ISO code as the option value) is still not needed. One row per dialling code already covers shared codes, because the row names every territory on it and each one can be searched.
- Tests:
  - `apps/staff/app/apply/__tests__/dial-and-dob.test.ts` covers the search ranking and the date formatting.
  - `pickers.test.tsx` drives both controls in jsdom.
  - `emergency-contact.test.tsx` now checks the picker's button instead of `<option selected>`.

## Update — the date-typing helpers live in packages/domain (ADR-0069)

`formatDobTyping`, `dobValueFrom` and `dobShownFrom` moved to `packages/domain/src/dob.ts`
so the Back Office's "Correct date of birth" dialog types a date exactly as `/apply` does;
`apps/staff/app/apply/dob.ts` re-exports them, so every Staff App import is unchanged.
`DobInput` itself stays in the Staff App and is now also used by the Documents hub's New
share code form and Request a change → Date of birth. See
[ADR-0069](0069-date-of-birth-corrections.md).
