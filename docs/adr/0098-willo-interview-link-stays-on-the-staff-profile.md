# ADR-0098 · The Willo interview link stays on the staff profile

**Status:** Accepted (owner request, 06.10.2026). An addition to scope v1.6 §2.4, which puts the link on the *candidate* profile only.

## Context

§2.4: "The candidate profile carries a direct 'Review interview on Willo' link." The link is built from `staff.willo_candidate_id` and `settings.willo_review_url_template`. The handle stays on the `staff` row for good, but only the onboarding candidate screen drew the link, so once someone was working the Staff profile (§9.6) gave the office no way back to the interview.

THC want the interview to be something that can always be referred to.

## Decision

The Staff profile's **Overview** tab carries an **Interview** row: "Review interview on Willo ↗" (new tab) for anyone with a link, "No interview link on file" otherwise.

- **Data:** read from `onboarding_candidates_v.willo_review_url` — the column the candidate screen already uses, so no migration and no new grant. A failed read shows no link.
- **Who:** every office login that can open the profile; the link is just a URL into Willo, where Willo's own login decides who can watch.
- **Removed (§1.7):** GDPR removal nulls `willo_candidate_id`, so a removed profile shows no link. Deleting the video at Willo is a separate step (docs/15-open-questions.md).

## Consequences

- The link is only as durable as the video at Willo. How long Willo keeps interviews is Willo's retention setting, not recorded in this repo; THC should confirm it matches how long they want to refer back.
- Until THC's Willo account and `willo_review_url_template` are set, every row reads "No interview link on file".
