# Request to Willo support: interview invitations going to junk

**To:** Willo support (support@willotalent.com, or the in-app chat)
**Account:** The Hospitality Company
**Subject:** Interview invitations landing in candidates' junk folders — custom sending domain?

---

Hi Willo team,

We're The Hospitality Company, an event-staffing agency. Every candidate we recruit gets a Willo interview invitation, and we've found that these emails are landing in junk or spam for some candidates.

**What we're seeing**
- Sender shows as "The Hospitality Company via Willo", sent from `notification@willotalent.com`.
- Subject begins "Your interview…" (the standard invitation template).
- The most recent example arrived on 30 September 2026 in the iPhone Mail app and was filed as junk. The message body is the standard "Thanks for your interest… Start assessment" template with a link to `app.willotalent.com/invite/…`.
- Candidates who don't check junk never start the interview, so we lose applicants.

**What we'd like help with**
1. **Custom sending domain.** Can we send invitations from our own domain, for example `interviews@thehospitalitycompany.co.uk`, with SPF and DKIM aligned to that domain? If this is available on our plan, please send the DNS records we need to add and any steps on your side. If it needs a plan upgrade, please tell us which one.
2. **Authentication of the current sender.** If a custom domain isn't possible, please confirm that mail from `notification@willotalent.com` passes SPF, DKIM and DMARC alignment, and tell us your DMARC policy for `willotalent.com`.
3. **Reputation check.** Please check whether `willotalent.com` or the sending IPs are listed on any blocklist, or have had recent complaint spikes.
4. **Template advice.** If there are known content triggers in the default invitation (link shorteners, image-heavy layouts, wording), please tell us how to change the subject and body so it scores better with spam filters.
5. **Reply-To.** Please confirm which address candidates' replies go to, and whether we can set a monitored shared address such as `admin@thehospitalitycompany.co.uk`.

**Useful details on our side**
- Invitations are created through the Willo API when a candidate submits our application form, so we can share candidate IDs or timestamps for specific examples. Just ask.
- Our domain is `thehospitalitycompany.co.uk`, and we can add DNS records (TXT/CNAME) quickly once we have them.

Thanks very much. Please let us know what you need from us.

Kind regards,
[Name]
The Hospitality Company
[contact details]
