-- =====================================================================
-- Migration 20260930140100 · THC's own agreement (§2.11, Appendix B)
--
-- THC's "Agency Worker Contract For Services" (20 pages) was received
-- 26.09.2026. It is published here as a new contract_versions row; the
-- placeholder of 20260923120200 stays exactly as it was, because a
-- published version is immutable and anyone who signed it during testing
-- signed that text (staff.contract_version, audit_log 'contract_signed').
-- current_contract_version() takes the latest published_at, so from this
-- migration on the wizard shows — and sign_contract() accepts — this one.
--
-- How the text was taken from THC's PDF
-- -------------------------------------
-- Extracted, not retyped. Dropped: the cover page (its title and parties
-- repeat on page 2 and in the title column), the table of contents, the
-- "N of 20" page footers, and the wet-signature block on the last page
-- (in the app, ticking "I agree" is the signature, §2.11). Repaired: line
-- wrapping, two words split by the PDF's letter spacing ("f uture",
-- "self -certification"), the space in "1 April ." and the blank date
-- line, written "this ______ day of ______ 2026". Nothing is reworded:
-- the remaining text is THC's character for character, including its own
-- slips (for THC to correct in a later version, not us) — "(SI
-- 1988/1833)" for the WTR 1998, "s(in the case of" in 24.1.2, the
-- bracketed "[24] hours" and "[admin@…]", and "Temporary Agency Worker"
-- in 2.2.
--
-- Layout for contractParagraphs() (apps/staff/app/onboarding/content/
-- contract.ts): one paragraph per clause heading, sub-clause and 1.1
-- definition; each top-level heading written "N. HEADING." so it is drawn
-- bold. THC's headings carry no full stop; that one character is added.
--
-- Clause 28 is OURS, not THC's. §2.11 requires "an ongoing duty to
-- disclose: the worker undertakes to declare any unspent criminal
-- conviction that arises during their employment … using the declaration
-- route in the app (§10.7)", and contract_versions' CHECK refuses a
-- version without it. THC's document has no such clause, so one is added
-- after clause 27 and before the closing line, in THC's defined terms.
-- The row is therefore is_placeholder = true: clause 28 awaits THC's
-- (solicitor's) approval, and the contract step says so. When THC
-- approves it — or supplies its own wording — that is a new version.
--
-- Forward-only.
-- =====================================================================

insert into contract_versions (version, title, body, published_at, is_placeholder)
values (
  'thc-agency-worker-2026-09',
  'Agency Worker Contract for Services — The Hospitality Company (London) Limited',
  btrim($contract$
THIS AGREEMENT is dated this ______ day of ______ 2026.

PARTIES

(1) THE HOSPITALITY COMPANY (LONDON) LIMITED t/a THE HOSPITALITY COMPANY incorporated and registered in England and Wales with company number 12411407 whose registered office is at 159 High Street, Barnet, Hertfordshire, England, EN5 5SU ("Employment Business");

(2) Temporary Worker ("Temporary Worker").

AGREED TERMS

1. INTERPRETATION.

1.1 The definitions and rules of interpretation in this clause apply to this Agreement.

"Assignment" means the temporary services to be carried out by the Temporary Worker for the Client, as more particularly described in clause 3 and in the Booking Placement Information.

"AWR 2010" means the Agency Workers Regulations 2010 (SI 2010/93).

"Booking Placement Information" means written confirmation of the detail of a particular Assignment contained on the Staff APP.

"Business Day" means a day other than a Saturday, Sunday or public holiday when banks in London are open for business.

"Calendar Week" means shall have the meaning in regulation 7(4) of the AWR 2010.

"Client" means a person, firm, partnership, company or Group company (as the case may be) to whom the Temporary Worker is Introduced or supplied.

"Conduct Regulations 2003" means the Conduct of Employment Agencies and Employment Business Regulations 2003 (SI 2003/3319).

"Confidential Information" means information in whatever form (including without limitation, in written, oral, visual or electronic form or on any magnetic or optical disk or memory and wherever located) relating to the business, customers, products, affairs and finances of the Client, the Employment Business for the time being confidential to the Client, the Employment Business and trade secrets including, without limitation, technical data and know-how relating to the business of the Client or the Employment Business or any of its or their suppliers, customers, agents, distributors, shareholders, management or business contacts, and including (but not limited to) information that the Temporary Worker creates, develops, receives or obtains in connection with the Assignment, whether or not such information (if in anything other than oral form) is marked confidential.

"Demand" means any action, award, claim or other legal recourse, complaint, cost, debt, demand, expense, fine, liability, loss, outgoing, penalty or proceeding.

"Engage" means the employment of a Temporary Worker or the engagement directly or indirectly through any employment business other than through the Employment Business (whether for a definite or indefinite period) of a Temporary Worker as a direct result of any Introduction or Assignment to the Client and the term Engaged shall be construed accordingly.

"Group" means in relation to a company, that company, each and any subsidiary or holding company from time to time of that company, and each and any subsidiary from time to time of a holding company of that company.

"Holding company" has the meaning given in clause 1.5.

"Intellectual Property Rights" means patents, rights to inventions, copyright and related rights, moral rights, trade marks, trade names and domain names, rights in get-up, rights in goodwill or to sue for passing off, rights in designs, rights in computer software, database rights, rights in confidential information (including know-how and trade secrets) and any other intellectual property rights, in each case whether registered or unregistered and including all applications (or rights to apply) for, and renewals or extensions of, such rights and all similar or equivalent rights or forms of protection which may now or in the future subsist in any part of the world.

"Introduce" means the provision to the Client of information by the Employment Business by way of a curriculum vitae or in such format as the Client may from time to time require which identifies the Temporary Worker and Introduction and Introduced shall be construed accordingly.

"Introduction Fee" means a fee payable by the Client to the Employment Business in the circumstances set out in clause 4.

"Other Qualifying Period Payment" means any remuneration payable to the Temporary Worker (other than the Qualifying Period Rate of Pay), which is not excluded by virtue of regulation 6 of the AWR 2010, such as any overtime, shift premium, commission or any bonus, incentive or rewards which are directly attributable to the amount or quality of work done by a Temporary Worker and are not linked to a financial participation scheme (as defined by the AWR 2010).

"Qualifying Period" means 12 continuous Calendar Weeks, as defined in regulation 7 of the AWR 2010, subject always to regulations 8 and 9 of the AWR 2010.

"Qualifying Period Rate of Pay" means the rate of pay that will be paid to the Temporary Worker on completion of the Qualifying Period, if this rate is higher than the Rate of Pay. Such rate will be paid for each hour worked during an Assignment (to the nearest quarter hour) weekly in arrears, subject to any deductions that the Employment Business is required to make by law and to any deductions that the Temporary Worker has specifically agreed can be made.

"Rate of Pay" means the rate of pay that will be paid to the Temporary Worker prior to completion of the Qualifying Period. Such rate will be paid for each hour worked during an Assignment (to the nearest quarter hour) weekly in arrears, subject to any deductions that the Employment Business is required to make by law and to any deductions which the Temporary Worker has specifically agreed can be made.

"Relevant Period" means shall have the meaning set out in regulation 10(5) and (6) of the Conduct Regulations 2003.

"Relevant Terms and Conditions" means the relevant terms and conditions as defined in regulation 6 of the AWR 2010 that apply once the Temporary Worker has completed the Qualifying Period.

"Required Assignment Information" means shall have the meaning set out at clause 3.4.

"Subsidiary" has the meaning given in clause 1.5.

"Temporary Worker" means a worker Introduced and supplied by the Employment Business to the Client to provide services to the Client not as an employee of the Client, who is deemed to be an agency worker for the purposes of regulation 3 of the AWR 2010.

"Temporary Work Agency" means shall have the meaning set out in regulation 4(1) of the AWR 2010.

"Vulnerable Person" means shall have the meaning set out in regulation 2 of the Conduct Regulations 2003.

"WTR 1998" means the Working Time Regulations 1998 (SI 1988/1833).

1.2 A person includes a natural person, corporate or unincorporated body (whether or not having separate legal personality).

1.3 The Schedules form part of this Agreement and shall have effect as if set out in full in the body of this Agreement. Any reference to this Agreement includes the Schedules.

1.4 A reference to a company shall include any company, corporation or other body corporate, wherever and however incorporated or established.

1.5 A reference to a holding company or a subsidiary means a holding company or a subsidiary (as the case may be) as defined in section 1159 of the Companies Act 2006 and a company shall be treated, for the purposes only of the membership requirement contained in sections 1159(1)(b) and (c), as a member of another company even if its shares in that other company are registered in the name of (a) another person (or its nominee) by way of security or in connection with the taking of security, or (b) its nominee. In the case of a limited liability partnership which is a subsidiary of a company or another limited liability partnership, section 1159 of the Companies Act 2006 shall be amended so that: (a) references in sections 1159(1)(a) and (c) to voting rights are to the members' rights to vote on all or substantially all matters which are decided by a vote of the members of the limited liability partnership; and (b) the reference in section 1159(1)(b) to the right to appoint or remove a majority of its board of directors is to the right to appoint or remove members holding a majority of the voting rights.

1.6 A reference to a statute or statutory provision is a reference to it as amended, extended or re-enacted from time to time.

1.7 A reference to a statute or statutory provision includes all subordinate legislation made from time to time under that statute or statutory provision.

1.8 A reference to writing or written includes email.

1.9 Any obligation on a party not to do something includes an obligation not to allow that thing to be done.

1.10 A reference to this Agreement or to any other agreement or document referred to in this Agreement is a reference to this Agreement or such other agreement or document as varied or novated (in each case, other than in breach of the provisions of this Agreement) from time to time.

1.11 References to clauses and Schedules are to the clauses and Schedules of this Agreement and references to paragraphs are to paragraphs of the relevant Schedule.

1.12 Any words following the terms including, include, in particular, for example or any similar expression shall be construed as illustrative and shall not limit the sense of the words, description, definition, phrase or term preceding those terms.

2. THE AGREEMENT.

2.1 These terms set out the entire agreement between the Employment Business and the Temporary Worker for the supply of services to a Client and shall govern all Assignments undertaken by the Temporary Worker (including, for the avoidance of doubt, where the Temporary Worker undertakes an Assignment without having signed these terms). No contract shall exist between the Employment Business and the Temporary Worker between Assignments.

2.2 The first Assignment will start on the date notified to the Temporary Agency Worker in accordance with clause 3.4 below. The Employment Business will also notify the Temporary Worker of the start date of any subsequent Assignment.

2.3 For the avoidance of doubt, this Agreement constitutes a contract for services and not a contract of employment between the Employment Business and the Temporary Worker or the Temporary Worker and the Client.

2.4 For the purposes of the Conduct Regulations 2003, the Employment Business acts as an Employment Business in relation to the Introduction and supply of the Temporary Worker to the Client.

3. ASSIGNMENTS.

3.1 No probationary period applies to the Temporary Worker's engagement by the Employment Business.

3.2 The Employment Business will endeavour to obtain suitable Assignments for the Temporary Worker to perform Waiting, Bar, Cocktail Bar, Cloakroom, Supervisor, Manager, Team Leader work. The Employment Business is not obliged to offer an Assignment to the Temporary Worker and the Temporary Worker shall not be obliged to accept any Assignment offered by the Employment Business.

3.3 The Temporary Worker acknowledges that the nature of temporary work means that there may be periods when no suitable work is available. The Temporary Worker agrees that suitability of an Assignment shall be determined solely by the Employment Business and that the Employment Business shall incur no liability to the Temporary Worker should it fail to offer any Assignments.

3.4 Except as provided below, at the same time as an Assignment is offered to the Temporary Worker, the Employment Business shall provide the Temporary Worker with the following information (the Required Assignment Information):

3.4.1 the identity of the Client, and if applicable the nature of its business;

3.4.2 the date the Assignment is to commence and the duration or likely duration of the Assignment;

3.4.3 the position which the Client seeks to fill, including the type of work the Temporary Worker in that position would be required to do, the location at which, and the days and hours during which, the Temporary Worker would be required to work;

3.4.4 the Rate of Pay and any expenses payable by or to the Temporary Worker;

3.4.5 any risks to health and safety known to the Client in relation to the Assignment and the steps the Client has taken to prevent or control such risks; and

3.4.6 the experience, training, qualifications and any authorisation which the Client considers are necessary or which are required by law or a professional body for the Temporary Worker to possess in order to work in the Assignment.

3.5 Where the Required Assignment Information is not given in paper form or by electronic means, the Employment Business shall confirm it in writing or electronically as soon as possible and in any event no later than the end of the third Business Day following the day on which the Assignment was offered to the Temporary Worker.

3.6 Unless the Temporary Worker requests otherwise, clause 3.4 will not apply where the Temporary Worker is being Introduced or supplied to the Client to work in the same position as one in which the Temporary Worker has previously been supplied within the previous five Business Days and the Required Assignment Information (with the exception of the date or likely duration of the Assignment) is the same as that already given to the Temporary Worker.

3.7 Subject to clause 3.6 and clause 3.8, where the Assignment is intended to last for five consecutive Business Days or less and the Required Assignment Information has previously been given to the Temporary Worker and remains unchanged, the Employment Business shall provide written confirmation of the identity of the Client and the likely duration of the Assignment.

3.8 Where the provisions of clause 3.7 have been met but the Assignment extends beyond the intended five consecutive Business Day period, the Employment Business shall provide the remaining Required Assignment Information to the Temporary Worker in paper or electronic form within eight Business Days of the start of the Assignment or by the end of the Assignment, if sooner.

3.9 If the Temporary Worker has completed the Qualifying Period on the start date of the relevant Assignment or completes the Qualifying Period during the relevant Assignment, the Temporary Worker will be informed of the Qualifying Period Rate of Pay if different from the Rate of Pay, together with the Other Qualifying Period Payments and the other Relevant Terms and Conditions to which the Temporary Worker is now entitled under the AWR 2010.

3.10 If the Temporary Worker considers that they have not received the Relevant Terms and Conditions on completion of the Qualifying Period, the Temporary Worker may raise this in writing with the Employment Business setting out as fully as possible the basis of their concerns. The Employment Business shall, within 28 days of receiving such request, provide the Temporary Worker with a written statement setting out:

3.10.1 relevant information relating to the basic work and employment conditions of the workers of the Client;

3.10.2 the factors that the Employment Business considered when determining such basic work and employment conditions; and

3.10.3 where the Employment Business seeks to rely on the defence in regulation 5(3) of the AWR 2010, relevant information which:

3.10.3.1 explains the basis on which it is considered that an individual is a comparable employee; and

3.10.3.2 describes the basic work and employment conditions which apply to that employee.

4. TEMPORARY TO PERMANENT.

4.1 The Temporary Worker acknowledges that the Employment Business will be entitled to charge the Client the Introduction Fee where:

4.1.1 the Client Engages the Temporary Worker within the Relevant Period; or

4.1.2 the Client introduces the Temporary Worker to a third party (other than another employment business) who subsequently Engages the Temporary Worker within the Relevant Period.

4.2 The Introduction Fee will not be payable in the circumstances described in clause 4.1.1 if the Client agrees to extend the period of the Assignment for a specified period at the end of which the Temporary Worker may be Engaged by the Client without further charge.

5. TEMPORARY WORKER'S OBLIGATIONS.

5.1 The Temporary Worker is not obliged to accept any Assignment offered by the Employment Business. If the Temporary Worker does accept an Assignment, the Temporary Worker shall:

5.1.1 co-operate with the Client's reasonable instructions and accept the direction, supervision and control of any responsible person in the Client's organisation;

5.1.2 observe any relevant rules and regulations of the Client's organisation (including normal hours of work) of which the Temporary Worker has been informed or of which the Temporary Worker should be reasonably aware;

5.1.3 co-operate with the Employment Business in the completion and renewal of all mandatory checks, including in relation to the Temporary Worker's right to work in the UK;

5.1.4 ensure that they will not exceed the maximum permitted working hours stipulated by any visa conditions, and immediately notify the Employment Business of any changes to their visa status or if they take on additional work elsewhere that impacts these limits;

5.1.5 where the Assignment involves working with any Vulnerable Persons, provide the Employment Business with copies of any relevant qualifications or authorisations including an up-to-date Disclosure and Barring Service certificate and two references which are from persons who are not related to the Temporary Worker;

5.1.6 take all reasonable steps to safeguard their own health and safety and that of any other person who may be present or be affected by their actions on the Assignment and comply with the health and safety policies of the Client;

5.1.7 not engage in any conduct detrimental to the interests of the Employment Business or the Client;

5.1.8 comply with all relevant statutes, laws, regulations and codes of practice from time to time in force in the performance of the Assignment and applicable to the Client's business, including without limitation, any equal opportunities or non-harassment policies.

5.2 If the Temporary Worker accepts any Assignment offered by the Employment Business, as soon as possible before the commencement of each such Assignment and during each Assignment (as appropriate) and at any time at the Employment Business' request, the Temporary Worker undertakes to:

5.2.1 inform the Employment Business of any Calendar Weeks whether before the date of commencement of the relevant Assignment or during the relevant Assignment in which the Temporary Worker has worked in the same or a similar role with the Client via any third party;

5.2.2 provide the Employment Business with all the details of such work, including (without limitation) details of when, where and the period(s) during which such work was undertaken, the role performed and any other details requested by the Employment Business; and

5.2.3 inform the Employment Business if before the date of the commencement of the relevant Assignment the Temporary Worker has:

5.2.3.1 completed two or more assignments with the Client;

5.2.3.2 completed at least one assignment with the Client and one or more assignments with a member of the Client's Group; or

5.2.3.3 worked in more than two roles during an assignment with the Client and on at least two occasions has worked in a role that was not the same role as the previous role.

5.3 If the Temporary Worker is unable for any reason to attend work during the course of an Assignment, they should first inform the Employment Business at least [24] hours before their normal start time to enable alternative arrangements to be made. If this is not possible, the Temporary Worker should inform the Client and then the Employment Business as soon as possible.

5.4 If, either before or during the course of an Assignment, the Temporary Worker becomes aware of any reason why they may not be suitable for an Assignment, they shall notify the Employment Business without delay.

6. REMUNERATION.

6.1 Subject to the Employment Business receiving properly authorised time sheets for the Temporary Worker in accordance with clause 8, the Employment Business shall pay the Rate of Pay to the Temporary Worker until the Temporary Worker completes the Qualifying Period. The Rate of Pay will be set out in the relevant Booking Placement Information for a particular Assignment.

6.2 Subject to the Employment Business receiving properly authorised time sheets for the Temporary Worker in accordance with clause 8, if the Temporary Worker has completed the Qualifying Period on the start date of the relevant Assignment or following completion of the Qualifying Period during the relevant Assignment, the Employment Business shall pay to the Temporary Worker:

6.2.1 the Qualifying Period Rate of Pay; and

6.2.2 the Other Qualifying Period Payments,

which will be set out in the relevant Booking Placement Information.

6.3 Subject to any applicable statutory entitlement and to clause 9 and clause 10, the Temporary Worker is not entitled to receive payment from the Employment Business or the Client for time not spent working on the Assignment, whether in respect of holidays, illness or absence for any other reason, unless otherwise agreed.

7. BENEFITS. The Temporary Worker is not entitled to any benefits.

8. TIME SHEETS.

8.1 The Temporary Worker has no normal hours of work and will be required to work the hours and days as required by the Client during the Assignment. The Temporary Worker's hours and days of work will vary according to the needs of the Client and shifts may vary between 4 and 12 hours. The Temporary Worker will be notified of the hours and days they will be required to work in advance of accepting the Assignment (as specified in clause 3.4.3).

8.2 At the end of each week of an Assignment (or at the end of an Assignment if it is for a period of one week or less or is completed before the end of a week) the Employment Business will obtain from the Client a completed time sheet indicating the number of hours worked during the preceding week (or such lesser period) and signed by an authorised representative of the Client.

8.3 Subject to clause 8.4, the Employment Business shall pay the Temporary Worker for all hours worked on a weekly basis regardless of whether the Employment Business has received payment from the Client for those hours.

8.4 Where the Employment Business does not receive a properly authorised time sheet, any payment due to the Temporary Worker may be delayed while the Employment Business investigates (in a timely fashion) what hours, if any, were worked by the Temporary Worker. The Employment Business shall make no payment to the Temporary Worker for hours not worked.

8.5 For the avoidance of doubt and for the purposes of the WTR 1998, the Temporary Worker's working time shall only consist of those periods during which they are carrying out activities or duties for the Client as part of the Assignment. Time spent travelling to the Client's premises (with the exception of time spent travelling between two or more premises of the Client), lunch breaks and other rest breaks shall not count as part of the Temporary Worker's working time for these purposes. This clause 8.5 is subject to the Employment Business' obligations to provide the Temporary Worker with the Relevant Terms and Conditions on completion of the Qualifying Period.

8.6 The Temporary Worker acknowledges and accepts that it could be a criminal offence under the Fraud Act 2006 to falsify any time sheet, for example by claiming payment for hours that were not actually worked.

9. HOLIDAYS.

9.1 The Temporary Worker is entitled to paid holiday which shall accrue at the rate of 12.07% of hours worked.

9.2 On completion of the Qualifying Period, the Temporary Worker may become entitled to annual leave in addition to the entitlement under this contract. In those circumstances, the Employment Business will inform the Temporary Worker in the relevant Booking Placement Information of any such entitlement and the date from which such entitlement will commence.

9.3 The Employment Business's holiday year runs from 31 March to 1 April. The Temporary Worker's initial holiday year runs from the start date of the first Assignment under this contract until the end of the Employment Business's current holiday year, and will then align with the Employment Business's holiday year.

9.4 All holiday requests must be approved in writing in advance by payroll@thehospitalitycompany.co.uk and should be taken in the months of January and August. The Temporary Worker must give at least 14 days' notice of proposed holiday. The Employment Business may require the Temporary Worker to take or not to take holiday on particular dates, including public holidays.

9.5 An Assignment may include work on public holidays, in which case any request to take holiday on a public holiday must be approved in the usual way. Holiday taken on public holidays shall count towards the Temporary Worker's paid holiday entitlement under this contract.

9.6 Holiday can only be taken in the holiday year in which it accrues otherwise it will be lost, except in the following cases:

9.6.1 Holiday may be carried over if the Temporary Worker has been unable to take it in the holiday year in which it accrued due to being on sick leave. It will be lost if not taken within 18 months of the end of the holiday year in which it accrued.

9.7 Holiday pay will be paid at the end of the pay period in which holiday is taken, based on the Temporary Worker's average hourly rate at the start of the holiday. The average hourly rate is the average remuneration for all hours worked in the previous 52 weeks (or since the start of the Assignment, if less than 52 weeks).

10. SICKNESS ABSENCE.

10.1 If the Temporary Worker is absent from work for any reason, they must notify the Staffing Department of the reason for their absence as soon as possible but no later than 9.00am on the first day of absence.

10.2 If the Temporary Worker satisfies the qualifying conditions laid down by law, they may be entitled to receive Statutory Sick Pay (SSP) at the prevailing rate in respect of any period of sickness or injury during the Assignment. The Temporary Worker will not be entitled to any other payments during such period.

10.3 In all cases of absence, a self-certification form, which is available from the Staffing Department, must be completed on the Temporary Worker's return to work and supplied to the Staffing Department. For any period of incapacity due to sickness or injury which lasts for seven consecutive days or more, a doctor's certificate (a "statement of fitness for work") stating the reason for absence must be obtained at the Temporary Worker's own cost and supplied to the Staffing Department. Further certificates must be obtained if the absence continues for longer than the period of the original certificate.

10.4 The Temporary Worker's qualifying day for SSP purposes is Wednesday.

11. OTHER PAID LEAVE.

11.1 During the Assignment the Temporary Worker is not entitled to any other paid leave.

12. TRAINING. No training will be provided to the Temporary Worker.

13. TERMINATION.

13.1 The Temporary Worker may terminate the Assignment at any time by giving 7 days’ notice to the Employment Business (unless the Assignment is for a shorter period, in which case the Temporary Worker must work until the end of the Assignment). The Employment Business or the Client may terminate the Assignment at any time by giving the Temporary Worker 7 days’ notice (except where the Assignment is for a shorter period, or the Employment Business deems the Temporary Worker to be unsuitable for the position or in breach of the required standards, in which case the Assignment may be terminated without prior notice or liability).

13.2 The Temporary Worker acknowledges that the continuation of an Assignment is subject to and dependent on the continuation of the agreement entered into between the Employment Business and the Client. If that agreement is terminated for any reason, the Assignment shall cease with immediate effect without liability to the Temporary Worker, except for payment for work done up to the date of termination of the Assignment.

13.3 Unless exceptional circumstances apply, the Temporary Worker's failure to inform the Client or the Employment Business of their inability to attend work as required by clause 5.3 will be treated as termination of the Assignment by the Temporary Worker.

13.4 If the Temporary Worker is absent during the course of an Assignment and the Assignment has not otherwise been terminated, the Employment Business will be entitled to terminate the Assignment in accordance with clause 13.1 if the work to which the Temporary Worker was assigned is no longer available.

14. INTELLECTUAL PROPERTY RIGHTS. The Temporary Worker acknowledges that all Intellectual Property Rights deriving from services carried out by the Temporary Worker for the Client during the Assignment shall belong to the Client. Accordingly, the Temporary Worker shall execute all such documents and do all such acts as the Client shall from time to time require in order to give effect to the Client's rights pursuant to this clause.

15. CONFIDENTIALITY.

15.1 In order to protect the confidentiality and trade secrets of the Employment Business and the Client, the Temporary Worker agrees, subject to clause 15.2 and clause 15.3, not at any time:

15.1.1 whether during or after an Assignment (unless expressly so authorised by the Client or the Employment Business as a necessary part of the performance of their duties), to disclose to any person or to make use of any of the trade secrets or the Confidential Information of the Client or the Employment Business; or

15.1.2 to make any copy, abstract or summary of the whole or any part of any document or other material belonging to the Client or the Employment Business except when required to do so in the course of the Temporary Worker's duties under an Assignment, in which circumstances such copy abstract or summary would belong to the Client or the Employment Business, as appropriate.

15.2 The restriction in clause 15.1 does not apply to:

15.2.1 any use or disclosure authorised by the Client or the Employment Business or as required by law, a court of competent jurisdiction or any governmental or regulatory authority;

15.2.2 any information which is already in, or comes into, the public domain otherwise than through the Temporary Worker's unauthorised disclosure; or

15.2.3 any protected disclosure within the meaning of section 43A of the Employment Rights Act 1996.

15.3 Nothing in this clause 15 shall prevent the Temporary Worker or, where applicable, the Employment Business (or any of its officers, employees, workers or agents) from:

15.3.1 reporting a suspected criminal offence to the police or any law enforcement agency or disclosure co-operating with the police or any law enforcement agency regarding a criminal investigation or prosecution;

15.3.2 doing or saying anything that is required by HMRC or a regulator, ombudsman or supervisory authority;

15.3.3 whether required to or not, making a disclosure to, or co-operating with any investigation by, HMRC or a regulator, ombudsman or supervisory authority regarding any misconduct, wrongdoing or serious breach of regulatory requirements (including giving evidence at a hearing);

15.3.4 complying with an order from a court or tribunal to disclose or give evidence;

15.3.5 disclosing information to any person who owes a duty of confidentiality (which the Temporary Worker and the Employment Business agree not to waive) in respect of information disclosed to them, including legal or tax advisers or, in the case of the Temporary Worker, persons providing them with medical, therapeutic, counselling or support services (providing they owe the Temporary Worker a duty of confidentiality which remains unwaived); or

15.3.6 making any other disclosure as required by law.

15.4 At the end of each Assignment or on request the Temporary Worker agrees to deliver up to the Client or the Employment Business (as directed) all documents (including copies), ID cards, swipe cards, equipment, passwords, pass codes and other materials belonging to the Client which are in its possession, including any data produced, maintained or stored on the Client's computer systems or other electronic equipment.

16. DATA PROTECTION.

16.1 The Employment Business and the Client and any other intermediary involved in supplying the services of the Temporary Worker to the Client will collect and process information relating to the Temporary Worker in accordance with the Privacy notice which is on the intranet.

16.2 The Temporary Worker shall comply with the Data protection policy of both the Employment Business and the Client when handling personal data including personal data relating to any employee, worker, contractor, customer, client, supplier or agent of the Employment Business or Client.

16.3 The Employment Business may terminate this Agreement immediately by giving notice in writing to the Temporary Worker if it reasonably considers that the Temporary Worker has failed to comply with the Data protection policy of the Employment Business or the Client or any of the policies listed in this clause.

17. PENSIONS.

17.1 The Employment Business will comply with the employer pension duties in respect of a Temporary Worker in accordance with Part 1 of the Pensions Act 2008. Where the Temporary Worker is auto-enrolled, their contributions will be based on the Temporary Worker’s qualifying earnings.

18. DISCIPLINARY AND GRIEVANCE PROCEDURES.

18.1 There are no disciplinary rules and procedures, or grievance procedures, which apply to the engagement. However, if the Temporary Worker is dissatisfied with any decision to terminate this Agreement or is unhappy with another aspect of their work or the working relationship, they should contact [admin@thehospitalitycompany.co.uk].

19. WARRANTIES AND INDEMNITIES.

19.1 The Temporary Worker warrants that:

19.1.1 the information supplied to the Employment Business in any application documents is correct;

19.1.2 the Temporary Worker has the experience, training, qualifications and any authorisation which the Client considers are necessary or which are required by law or by any professional body for the Temporary Worker to possess in order to perform the Assignment;

19.1.3 the Temporary Worker is not prevented by any other agreement, arrangement, restriction (including, without limitation, a restriction in favour of any employment agency, employment business or client) or any other reason, from fulfilling the Temporary Worker's obligations under this Agreement; and

19.1.4 the Temporary Worker has valid and subsisting leave to enter and remain in the United Kingdom for the duration of this Agreement and is not (in relation to such leave) subject to any conditions which may preclude or have an adverse effect on the Assignment.

19.2 The Temporary Worker shall indemnify and keep indemnified the Employment Business and the Client against all Demands (including legal and other professional fees and expenses) which the Employment Business or the Client may suffer, sustain, incur, pay or be put to arising from or in connection with:

19.2.1 any failure by the Temporary Worker to comply with its obligations under this Agreement;

19.2.2 any negligent or fraudulent act or omission by the Temporary Worker;

19.2.3 the disclosure by the Temporary Worker of any Confidential Information;

19.2.4 any employment-related claim brought by the Temporary Worker in connection with the Assignment; or

19.2.5 the infringement by the Temporary Worker of the Client's or any Group Company's Intellectual Property Rights.

20. NO PARTNERSHIP OR AGENCY.

20.1 Nothing in this Agreement is intended to, or shall be deemed to, establish any partnership or joint venture between any of the parties, constitute any party the agent of another party, or authorise any party to make or enter into any commitments for or on behalf of any other party.

20.2 Each party confirms it is acting on its own behalf and not for the benefit of any other person.

21. COLLECTIVE AGREEMENTS.

21.1 There is no collective agreement which directly affects the Temporary Worker's engagement as a worker.

22. ENTIRE AGREEMENT.

22.1 This Agreement constitutes the entire agreement between the parties and supersedes and extinguishes all previous and contemporaneous agreements, promises, assurances, warranties, representations and understandings between them, whether written or oral, relating to its subject matter.

22.2 Each party acknowledges that in entering into this Agreement it does not rely on, and shall have no remedies in respect of, any statement, representation, assurance or warranty (whether made innocently or negligently) that is not set out in this Agreement.

22.3 No variation of this Agreement shall be effective unless it is in writing and signed by each of the parties (or their authorised representatives). A written copy of the varied terms, including the date from which they take effect, shall be given to the Temporary Worker no later than the fifth Business Day following the day on which the variation was agreed.

22.4 Each party agrees that it shall have no claim for innocent or negligent misrepresentation or negligent misstatement based on any statement in this Agreement.

23. THIRD PARTY RIGHTS. No one other than a party to this Agreement, their successors and permitted assignees, shall have any right to enforce any of its terms.

24. NOTICES.

24.1 A notice given to a party under or in connection with this Agreement shall be in writing and shall be:

24.1.1 delivered by hand or by pre-paid first-class post or other next working day delivery service at the address given in this Agreement or notified by that party in writing to the other party; or

24.1.2 sent by email to admin@thehospitalitycompany.co.uk s(in the case of a notice given by the Temporary Worker) or to the email address previously provided to the Employment Business by the Temporary Worker (in the case of a notice given by the Employment Business).

24.2 Unless proved otherwise, any such notice shall be deemed to have been received:

24.2.1 if delivered by hand, at the time the notice is left at the address given in this Agreement or given to the addressee;

24.2.2 if sent by pre-paid first-class post or other next working day delivery service providing proof of postage, at 9.00am on the Business Day after posting; or

24.2.3 if sent by email, at the time of transmission.

24.3 If deemed receipt under clause 24.2 would occur outside business hours in the place of receipt, it shall be deferred until business hours resume. In this clause 24.3, business hours means 9.00 am to 5.00 pm Monday to Friday on a day that is not a public holiday in the place of receipt.

24.4 This clause does not apply to the service of any proceedings or other documents in any legal action or, where applicable, any arbitration or other method of dispute resolution.

25. SEVERANCE.

25.1 If any provision or part-provision of this Agreement is or becomes invalid, illegal or unenforceable, it shall be deemed modified to the minimum extent necessary to make it valid, legal and enforceable. If such modification is not possible, the relevant provision or part-provision shall be deemed deleted. Any modification to or deletion of a provision or part-provision under this clause shall not affect the validity and enforceability of the rest of this Agreement.

25.2 If any provision or part-provision of this Agreement is invalid, illegal or unenforceable, the parties shall negotiate in good faith to amend such provision so that, as amended, it is legal, valid and enforceable, and, to the greatest extent possible, achieves the intended commercial result of the original provision.

26. GOVERNING LAW. This Agreement and any dispute or claim (including non-contractual disputes or claims) arising out of or in connection with it or its subject matter or formation shall be governed by and construed in accordance with the law of England and Wales.

27. JURISDICTION. Each party irrevocably agrees that the courts of England and Wales shall have exclusive jurisdiction to settle any dispute or claim (including non-contractual disputes or claims) arising out of or in connection with this Agreement or its subject matter or formation.

28. DUTY TO DISCLOSE CRIMINAL CONVICTIONS. The Temporary Worker confirms that the criminal-conviction declaration made during onboarding is accurate, and undertakes to declare any unspent criminal conviction that arises during this Agreement, as soon as reasonably practicable, using the "Declare a criminal conviction" route in the Staff App. The Employment Business may pause Assignments while such a declaration is reviewed.

THIS AGREEMENT has been entered into on the date stated at the beginning of it.
$contract$, E'\n'),
  now(),
  true
)
on conflict (version) do nothing;
