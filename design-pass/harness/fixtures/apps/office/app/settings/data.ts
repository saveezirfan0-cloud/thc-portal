export * from '../../../../../../../apps/office/app/settings/data';

export async function loadSettings() {
  return {
    weights: {
      show_rate: 0.3,
      rating: 0.25,
      proximity: 0.25,
      fair_rotation: 0.1,
      venue_history: 0.1,
    },
    willo: { new_response: 'interview_completed', accepted: 'documents', rejected: 'rejected' },
    willoReviewUrlTemplate: null,
    senders: {
      timesheets: 'timesheets@thehospitalitycompany.co.uk',
      admin: 'admin@thehospitalitycompany.co.uk',
    },
    recipients: {
      e5e6: ['gisela@thehospitalitycompany.co.uk'],
      e7: ['thc_payroll@topsourceworldwide.com'],
    },
    bookedElsewhereGapMinutes: 120,
    escalationRadiusMiles: 10,
    venueTypes: [
      { key: 'hotel', label: 'Hotel', default_radius_m: 150, sort_order: 1 },
      { key: 'stadium', label: 'Stadium / arena', default_radius_m: 500, sort_order: 2 },
      { key: 'other', label: 'Other', default_radius_m: 250, sort_order: 9 },
    ],
    rotaGuardMode: 'block',
    problem: null,
  };
}
