export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '14.5';
  };
  public: {
    Tables: {
      applications: {
        Row: {
          age_band: string;
          consented_at: string;
          created_at: string;
          dob: string;
          email: string;
          first_name: string;
          id: string;
          last_name: string;
          matched_on: string | null;
          outcome: Database['public']['Enums']['application_outcome'];
          phone: string;
          resolution: string | null;
          resolution_reason: string | null;
          resolved_at: string | null;
          resolved_by: string | null;
          staff_id: string;
        };
        Insert: {
          age_band: string;
          consented_at: string;
          created_at?: string;
          dob: string;
          email: string;
          first_name: string;
          id?: string;
          last_name: string;
          matched_on?: string | null;
          outcome: Database['public']['Enums']['application_outcome'];
          phone: string;
          resolution?: string | null;
          resolution_reason?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          staff_id: string;
        };
        Update: {
          age_band?: string;
          consented_at?: string;
          created_at?: string;
          dob?: string;
          email?: string;
          first_name?: string;
          id?: string;
          last_name?: string;
          matched_on?: string | null;
          outcome?: Database['public']['Enums']['application_outcome'];
          phone?: string;
          resolution?: string | null;
          resolution_reason?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          staff_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'applications_resolved_by_fkey';
            columns: ['resolved_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'applications_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'clients_qualified_staff_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'applications_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'compliance_radar_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'applications_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'onboarding_candidates_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'applications_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'onboarding_returning_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'applications_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'applications_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_block_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'applications_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_directory_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'applications_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_profile_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'applications_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_rejection_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'applications_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'student_visa_v';
            referencedColumns: ['id'];
          },
        ];
      };
      audit_log: {
        Row: {
          action: string;
          actor: string | null;
          at: string;
          data: Json | null;
          entity: string;
          entity_id: string | null;
          id: number;
        };
        Insert: {
          action: string;
          actor?: string | null;
          at?: string;
          data?: Json | null;
          entity: string;
          entity_id?: string | null;
          id?: never;
        };
        Update: {
          action?: string;
          actor?: string | null;
          at?: string;
          data?: Json | null;
          entity?: string;
          entity_id?: string | null;
          id?: never;
        };
        Relationships: [];
      };
      bank_details: {
        Row: {
          account_holder: string;
          account_number: string;
          sort_code: string;
          staff_id: string;
          updated_at: string;
        };
        Insert: {
          account_holder: string;
          account_number: string;
          sort_code: string;
          staff_id: string;
          updated_at?: string;
        };
        Update: {
          account_holder?: string;
          account_number?: string;
          sort_code?: string;
          staff_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'bank_details_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: true;
            referencedRelation: 'clients_qualified_staff_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'bank_details_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: true;
            referencedRelation: 'compliance_radar_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'bank_details_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: true;
            referencedRelation: 'onboarding_candidates_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'bank_details_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: true;
            referencedRelation: 'onboarding_returning_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'bank_details_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: true;
            referencedRelation: 'staff';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'bank_details_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: true;
            referencedRelation: 'staff_block_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'bank_details_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: true;
            referencedRelation: 'staff_directory_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'bank_details_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: true;
            referencedRelation: 'staff_profile_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'bank_details_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: true;
            referencedRelation: 'staff_rejection_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'bank_details_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: true;
            referencedRelation: 'student_visa_v';
            referencedColumns: ['id'];
          },
        ];
      };
      bookings: {
        Row: {
          applied_at: string | null;
          cancel_cause: string | null;
          cancelled_at: string | null;
          confirmed_at: string | null;
          created_at: string;
          day_before_confirmed_at: string | null;
          id: string;
          on_day_confirmed_at: string | null;
          reconfirm_reason: string | null;
          reconfirm_required: boolean;
          self_cancelled: boolean;
          shift_id: string;
          source: Database['public']['Enums']['booking_source'];
          staff_id: string;
          status: Database['public']['Enums']['booking_status'];
        };
        Insert: {
          applied_at?: string | null;
          cancel_cause?: string | null;
          cancelled_at?: string | null;
          confirmed_at?: string | null;
          created_at?: string;
          day_before_confirmed_at?: string | null;
          id?: string;
          on_day_confirmed_at?: string | null;
          reconfirm_reason?: string | null;
          reconfirm_required?: boolean;
          self_cancelled?: boolean;
          shift_id: string;
          source: Database['public']['Enums']['booking_source'];
          staff_id: string;
          status: Database['public']['Enums']['booking_status'];
        };
        Update: {
          applied_at?: string | null;
          cancel_cause?: string | null;
          cancelled_at?: string | null;
          confirmed_at?: string | null;
          created_at?: string;
          day_before_confirmed_at?: string | null;
          id?: string;
          on_day_confirmed_at?: string | null;
          reconfirm_reason?: string | null;
          reconfirm_required?: boolean;
          self_cancelled?: boolean;
          shift_id?: string;
          source?: Database['public']['Enums']['booking_source'];
          staff_id?: string;
          status?: Database['public']['Enums']['booking_status'];
        };
        Relationships: [
          {
            foreignKeyName: 'bookings_shift_id_fkey';
            columns: ['shift_id'];
            isOneToOne: false;
            referencedRelation: 'checkin_monitor_v';
            referencedColumns: ['shift_id'];
          },
          {
            foreignKeyName: 'bookings_shift_id_fkey';
            columns: ['shift_id'];
            isOneToOne: false;
            referencedRelation: 'client_lineup_v';
            referencedColumns: ['shift_id'];
          },
          {
            foreignKeyName: 'bookings_shift_id_fkey';
            columns: ['shift_id'];
            isOneToOne: false;
            referencedRelation: 'client_role_sections_v';
            referencedColumns: ['shift_id'];
          },
          {
            foreignKeyName: 'bookings_shift_id_fkey';
            columns: ['shift_id'];
            isOneToOne: false;
            referencedRelation: 'dashboard_sections_v';
            referencedColumns: ['shift_id'];
          },
          {
            foreignKeyName: 'bookings_shift_id_fkey';
            columns: ['shift_id'];
            isOneToOne: false;
            referencedRelation: 'dashboard_upcoming_v';
            referencedColumns: ['shift_id'];
          },
          {
            foreignKeyName: 'bookings_shift_id_fkey';
            columns: ['shift_id'];
            isOneToOne: false;
            referencedRelation: 'payable_shifts_v';
            referencedColumns: ['shift_id'];
          },
          {
            foreignKeyName: 'bookings_shift_id_fkey';
            columns: ['shift_id'];
            isOneToOne: false;
            referencedRelation: 'shift_requirements';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'bookings_shift_id_fkey';
            columns: ['shift_id'];
            isOneToOne: false;
            referencedRelation: 'staff_shift_history_v';
            referencedColumns: ['shift_id'];
          },
          {
            foreignKeyName: 'bookings_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'clients_qualified_staff_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'bookings_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'compliance_radar_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'bookings_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'onboarding_candidates_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'bookings_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'onboarding_returning_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'bookings_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'bookings_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_block_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'bookings_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_directory_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'bookings_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_profile_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'bookings_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_rejection_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'bookings_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'student_visa_v';
            referencedColumns: ['id'];
          },
        ];
      };
      breaks: {
        Row: {
          booking_id: string;
          ended_at: string | null;
          id: string;
          started_at: string;
        };
        Insert: {
          booking_id: string;
          ended_at?: string | null;
          id?: string;
          started_at: string;
        };
        Update: {
          booking_id?: string;
          ended_at?: string | null;
          id?: string;
          started_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'breaks_booking_id_fkey';
            columns: ['booking_id'];
            isOneToOne: false;
            referencedRelation: 'bookings';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'breaks_booking_id_fkey';
            columns: ['booking_id'];
            isOneToOne: false;
            referencedRelation: 'checkin_monitor_v';
            referencedColumns: ['booking_id'];
          },
          {
            foreignKeyName: 'breaks_booking_id_fkey';
            columns: ['booking_id'];
            isOneToOne: false;
            referencedRelation: 'client_lineup_v';
            referencedColumns: ['booking_id'];
          },
          {
            foreignKeyName: 'breaks_booking_id_fkey';
            columns: ['booking_id'];
            isOneToOne: false;
            referencedRelation: 'payable_shifts_v';
            referencedColumns: ['booking_id'];
          },
          {
            foreignKeyName: 'breaks_booking_id_fkey';
            columns: ['booking_id'];
            isOneToOne: false;
            referencedRelation: 'staff_shift_history_v';
            referencedColumns: ['booking_id'];
          },
        ];
      };
      cap_band_notices: {
        Row: {
          band: Database['public']['Enums']['cap_band'];
          cap_hours: number | null;
          notified_on: string;
          staff_id: string;
        };
        Insert: {
          band: Database['public']['Enums']['cap_band'];
          cap_hours?: number | null;
          notified_on: string;
          staff_id: string;
        };
        Update: {
          band?: Database['public']['Enums']['cap_band'];
          cap_hours?: number | null;
          notified_on?: string;
          staff_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'cap_band_notices_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: true;
            referencedRelation: 'clients_qualified_staff_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'cap_band_notices_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: true;
            referencedRelation: 'compliance_radar_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'cap_band_notices_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: true;
            referencedRelation: 'onboarding_candidates_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cap_band_notices_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: true;
            referencedRelation: 'onboarding_returning_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'cap_band_notices_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: true;
            referencedRelation: 'staff';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cap_band_notices_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: true;
            referencedRelation: 'staff_block_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'cap_band_notices_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: true;
            referencedRelation: 'staff_directory_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cap_band_notices_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: true;
            referencedRelation: 'staff_profile_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cap_band_notices_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: true;
            referencedRelation: 'staff_rejection_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'cap_band_notices_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: true;
            referencedRelation: 'student_visa_v';
            referencedColumns: ['id'];
          },
        ];
      };
      check_logs: {
        Row: {
          attempted_at: string;
          booking_id: string;
          check_in_at: string | null;
          check_out_at: string | null;
          check_out_on_site: boolean | null;
          check_out_pressed_at: string | null;
          distance_m: number | null;
          id: string;
          last_on_site_at: string | null;
          location: unknown;
          manager_finish_at: string | null;
          on_site_verified: boolean;
          outcome: Database['public']['Enums']['checklog_outcome'];
        };
        Insert: {
          attempted_at?: string;
          booking_id: string;
          check_in_at?: string | null;
          check_out_at?: string | null;
          check_out_on_site?: boolean | null;
          check_out_pressed_at?: string | null;
          distance_m?: number | null;
          id?: string;
          last_on_site_at?: string | null;
          location?: unknown;
          manager_finish_at?: string | null;
          on_site_verified?: boolean;
          outcome: Database['public']['Enums']['checklog_outcome'];
        };
        Update: {
          attempted_at?: string;
          booking_id?: string;
          check_in_at?: string | null;
          check_out_at?: string | null;
          check_out_on_site?: boolean | null;
          check_out_pressed_at?: string | null;
          distance_m?: number | null;
          id?: string;
          last_on_site_at?: string | null;
          location?: unknown;
          manager_finish_at?: string | null;
          on_site_verified?: boolean;
          outcome?: Database['public']['Enums']['checklog_outcome'];
        };
        Relationships: [
          {
            foreignKeyName: 'check_logs_booking_id_fkey';
            columns: ['booking_id'];
            isOneToOne: false;
            referencedRelation: 'bookings';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'check_logs_booking_id_fkey';
            columns: ['booking_id'];
            isOneToOne: false;
            referencedRelation: 'checkin_monitor_v';
            referencedColumns: ['booking_id'];
          },
          {
            foreignKeyName: 'check_logs_booking_id_fkey';
            columns: ['booking_id'];
            isOneToOne: false;
            referencedRelation: 'client_lineup_v';
            referencedColumns: ['booking_id'];
          },
          {
            foreignKeyName: 'check_logs_booking_id_fkey';
            columns: ['booking_id'];
            isOneToOne: false;
            referencedRelation: 'payable_shifts_v';
            referencedColumns: ['booking_id'];
          },
          {
            foreignKeyName: 'check_logs_booking_id_fkey';
            columns: ['booking_id'];
            isOneToOne: false;
            referencedRelation: 'staff_shift_history_v';
            referencedColumns: ['booking_id'];
          },
        ];
      };
      client_qualifications: {
        Row: {
          client_id: string;
          do_not_return: boolean;
          granted_at: string;
          granted_by: string | null;
          granted_from_event: string | null;
          id: string;
          note: string | null;
          role_id: string;
          staff_id: string;
        };
        Insert: {
          client_id: string;
          do_not_return?: boolean;
          granted_at?: string;
          granted_by?: string | null;
          granted_from_event?: string | null;
          id?: string;
          note?: string | null;
          role_id: string;
          staff_id: string;
        };
        Update: {
          client_id?: string;
          do_not_return?: boolean;
          granted_at?: string;
          granted_by?: string | null;
          granted_from_event?: string | null;
          id?: string;
          note?: string | null;
          role_id?: string;
          staff_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'client_qualifications_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'client_company_v';
            referencedColumns: ['client_id'];
          },
          {
            foreignKeyName: 'client_qualifications_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'clients';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'client_qualifications_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'clients_directory_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'client_qualifications_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'feedback_entries_v';
            referencedColumns: ['client_id'];
          },
          {
            foreignKeyName: 'client_qualifications_granted_by_fkey';
            columns: ['granted_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'client_qualifications_role_id_fkey';
            columns: ['role_id'];
            isOneToOne: false;
            referencedRelation: 'role_directory_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'client_qualifications_role_id_fkey';
            columns: ['role_id'];
            isOneToOne: false;
            referencedRelation: 'roles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'client_qualifications_role_id_fkey';
            columns: ['role_id'];
            isOneToOne: false;
            referencedRelation: 'staff_shift_history_v';
            referencedColumns: ['role_id'];
          },
          {
            foreignKeyName: 'client_qualifications_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'clients_qualified_staff_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'client_qualifications_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'compliance_radar_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'client_qualifications_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'onboarding_candidates_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'client_qualifications_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'onboarding_returning_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'client_qualifications_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'client_qualifications_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_block_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'client_qualifications_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_directory_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'client_qualifications_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_profile_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'client_qualifications_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_rejection_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'client_qualifications_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'student_visa_v';
            referencedColumns: ['id'];
          },
        ];
      };
      client_rate_cards: {
        Row: {
          charge_rate: number;
          client_id: string;
          dress_codes: string[];
          id: string;
          role_id: string;
        };
        Insert: {
          charge_rate: number;
          client_id: string;
          dress_codes?: string[];
          id?: string;
          role_id: string;
        };
        Update: {
          charge_rate?: number;
          client_id?: string;
          dress_codes?: string[];
          id?: string;
          role_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'client_rate_cards_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'client_company_v';
            referencedColumns: ['client_id'];
          },
          {
            foreignKeyName: 'client_rate_cards_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'clients';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'client_rate_cards_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'clients_directory_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'client_rate_cards_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'feedback_entries_v';
            referencedColumns: ['client_id'];
          },
          {
            foreignKeyName: 'client_rate_cards_role_id_fkey';
            columns: ['role_id'];
            isOneToOne: false;
            referencedRelation: 'role_directory_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'client_rate_cards_role_id_fkey';
            columns: ['role_id'];
            isOneToOne: false;
            referencedRelation: 'roles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'client_rate_cards_role_id_fkey';
            columns: ['role_id'];
            isOneToOne: false;
            referencedRelation: 'staff_shift_history_v';
            referencedColumns: ['role_id'];
          },
        ];
      };
      clients: {
        Row: {
          contact_emails: string[];
          contact_name: string;
          created_at: string;
          id: string;
          name: string;
          pays_breaks: boolean;
          pays_buffer: boolean;
          phone: string;
          staff_contact_point: string;
        };
        Insert: {
          contact_emails: string[];
          contact_name: string;
          created_at?: string;
          id?: string;
          name: string;
          pays_breaks?: boolean;
          pays_buffer?: boolean;
          phone: string;
          staff_contact_point: string;
        };
        Update: {
          contact_emails?: string[];
          contact_name?: string;
          created_at?: string;
          id?: string;
          name?: string;
          pays_breaks?: boolean;
          pays_buffer?: boolean;
          phone?: string;
          staff_contact_point?: string;
        };
        Relationships: [];
      };
      compliance_docs: {
        Row: {
          ai_confidence: number | null;
          ai_extracted: Json | null;
          awarding_institution: string | null;
          completion_date: string | null;
          completion_date_claimed: string | null;
          confirmed_visa_expiry: string | null;
          doc_type: Database['public']['Enums']['doc_type'];
          evidence_form: string | null;
          expiry_date: string | null;
          file_name: string | null;
          file_path: string | null;
          file_size: number | null;
          gov_report_path: string | null;
          id: string;
          manual_review_reason: string | null;
          mime_type: string | null;
          needs_manual_review: boolean;
          ni_matched_at: string | null;
          ni_matched_by: string | null;
          ni_recheck: boolean;
          rejection_reason: string | null;
          retain_until: string | null;
          review_status: Database['public']['Enums']['review_status'];
          reviewed_at: string | null;
          reviewed_by: string | null;
          right_to_work_until: string | null;
          rtw_no_time_limit: boolean;
          share_code: string | null;
          size_bytes: number | null;
          staff_id: string;
          term_dates: unknown[] | null;
          uploaded_at: string;
        };
        Insert: {
          ai_confidence?: number | null;
          ai_extracted?: Json | null;
          awarding_institution?: string | null;
          completion_date?: string | null;
          completion_date_claimed?: string | null;
          confirmed_visa_expiry?: string | null;
          doc_type: Database['public']['Enums']['doc_type'];
          evidence_form?: string | null;
          expiry_date?: string | null;
          file_name?: string | null;
          file_path?: string | null;
          file_size?: number | null;
          gov_report_path?: string | null;
          id?: string;
          manual_review_reason?: string | null;
          mime_type?: string | null;
          needs_manual_review?: boolean;
          ni_matched_at?: string | null;
          ni_matched_by?: string | null;
          ni_recheck?: boolean;
          rejection_reason?: string | null;
          retain_until?: string | null;
          review_status?: Database['public']['Enums']['review_status'];
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          right_to_work_until?: string | null;
          rtw_no_time_limit?: boolean;
          share_code?: string | null;
          size_bytes?: number | null;
          staff_id: string;
          term_dates?: unknown[] | null;
          uploaded_at?: string;
        };
        Update: {
          ai_confidence?: number | null;
          ai_extracted?: Json | null;
          awarding_institution?: string | null;
          completion_date?: string | null;
          completion_date_claimed?: string | null;
          confirmed_visa_expiry?: string | null;
          doc_type?: Database['public']['Enums']['doc_type'];
          evidence_form?: string | null;
          expiry_date?: string | null;
          file_name?: string | null;
          file_path?: string | null;
          file_size?: number | null;
          gov_report_path?: string | null;
          id?: string;
          manual_review_reason?: string | null;
          mime_type?: string | null;
          needs_manual_review?: boolean;
          ni_matched_at?: string | null;
          ni_matched_by?: string | null;
          ni_recheck?: boolean;
          rejection_reason?: string | null;
          retain_until?: string | null;
          review_status?: Database['public']['Enums']['review_status'];
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          right_to_work_until?: string | null;
          rtw_no_time_limit?: boolean;
          share_code?: string | null;
          size_bytes?: number | null;
          staff_id?: string;
          term_dates?: unknown[] | null;
          uploaded_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'compliance_docs_ni_matched_by_fkey';
            columns: ['ni_matched_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'compliance_docs_reviewed_by_fkey';
            columns: ['reviewed_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'compliance_docs_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'clients_qualified_staff_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'compliance_docs_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'compliance_radar_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'compliance_docs_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'onboarding_candidates_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'compliance_docs_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'onboarding_returning_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'compliance_docs_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'compliance_docs_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_block_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'compliance_docs_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_directory_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'compliance_docs_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_profile_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'compliance_docs_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_rejection_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'compliance_docs_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'student_visa_v';
            referencedColumns: ['id'];
          },
        ];
      };
      contract_versions: {
        Row: {
          body: string;
          created_at: string;
          is_placeholder: boolean;
          published_at: string;
          title: string;
          version: string;
        };
        Insert: {
          body: string;
          created_at?: string;
          is_placeholder?: boolean;
          published_at?: string;
          title: string;
          version: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          is_placeholder?: boolean;
          published_at?: string;
          title?: string;
          version?: string;
        };
        Relationships: [];
      };
      criminal_declarations: {
        Row: {
          answer: boolean;
          conviction_date: string | null;
          declared_at: string;
          details: string | null;
          id: string;
          review_note: string | null;
          review_status: Database['public']['Enums']['review_status'];
          reviewed_at: string | null;
          reviewed_by: string | null;
          source: Database['public']['Enums']['declaration_source'];
          staff_id: string;
          superseded: boolean;
        };
        Insert: {
          answer: boolean;
          conviction_date?: string | null;
          declared_at?: string;
          details?: string | null;
          id?: string;
          review_note?: string | null;
          review_status?: Database['public']['Enums']['review_status'];
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          source: Database['public']['Enums']['declaration_source'];
          staff_id: string;
          superseded?: boolean;
        };
        Update: {
          answer?: boolean;
          conviction_date?: string | null;
          declared_at?: string;
          details?: string | null;
          id?: string;
          review_note?: string | null;
          review_status?: Database['public']['Enums']['review_status'];
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          source?: Database['public']['Enums']['declaration_source'];
          staff_id?: string;
          superseded?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'criminal_declarations_reviewed_by_fkey';
            columns: ['reviewed_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'criminal_declarations_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'clients_qualified_staff_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'criminal_declarations_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'compliance_radar_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'criminal_declarations_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'onboarding_candidates_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'criminal_declarations_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'onboarding_returning_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'criminal_declarations_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'criminal_declarations_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_block_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'criminal_declarations_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_directory_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'criminal_declarations_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_profile_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'criminal_declarations_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_rejection_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'criminal_declarations_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'student_visa_v';
            referencedColumns: ['id'];
          },
        ];
      };
      event_documents: {
        Row: {
          event_id: string;
          file_name: string;
          generated_at: string;
          generated_by: string | null;
          id: string;
          kind: string;
          outbox_key: string | null;
          page_count: number;
          queued_at: string | null;
          recipients: string[] | null;
          row_count: number;
          send_error: string | null;
          send_failed_at: string | null;
          sent_at: string | null;
          storage_path: string;
        };
        Insert: {
          event_id: string;
          file_name: string;
          generated_at?: string;
          generated_by?: string | null;
          id?: string;
          kind: string;
          outbox_key?: string | null;
          page_count: number;
          queued_at?: string | null;
          recipients?: string[] | null;
          row_count: number;
          send_error?: string | null;
          send_failed_at?: string | null;
          sent_at?: string | null;
          storage_path: string;
        };
        Update: {
          event_id?: string;
          file_name?: string;
          generated_at?: string;
          generated_by?: string | null;
          id?: string;
          kind?: string;
          outbox_key?: string | null;
          page_count?: number;
          queued_at?: string | null;
          recipients?: string[] | null;
          row_count?: number;
          send_error?: string | null;
          send_failed_at?: string | null;
          sent_at?: string | null;
          storage_path?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'event_documents_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'client_events_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'event_documents_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'clients_event_list_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'event_documents_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'events';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'event_documents_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'staff_feedback_v';
            referencedColumns: ['event_id'];
          },
          {
            foreignKeyName: 'event_documents_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'staff_shift_history_v';
            referencedColumns: ['event_id'];
          },
          {
            foreignKeyName: 'event_documents_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'staff_violations_v';
            referencedColumns: ['event_id'];
          },
          {
            foreignKeyName: 'event_documents_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'venue_upcoming_events_v';
            referencedColumns: ['event_id'];
          },
          {
            foreignKeyName: 'event_documents_generated_by_fkey';
            columns: ['generated_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      events: {
        Row: {
          auto_assign: boolean;
          cancel_reason: string | null;
          cancelled_at: string | null;
          cancelled_by: string | null;
          client_id: string;
          created_at: string;
          created_by: string | null;
          event_date: string;
          geofence_radius_m: number;
          id: string;
          notes: string | null;
          onsite_contact: string | null;
          payroll_exported_at: string | null;
          pays_breaks: boolean;
          pays_buffer: boolean;
          po_number: string | null;
          title: string;
          venue_address: string;
          venue_id: string | null;
          venue_location: unknown;
          venue_name: string;
        };
        Insert: {
          auto_assign?: boolean;
          cancel_reason?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          client_id: string;
          created_at?: string;
          created_by?: string | null;
          event_date: string;
          geofence_radius_m: number;
          id?: string;
          notes?: string | null;
          onsite_contact?: string | null;
          payroll_exported_at?: string | null;
          pays_breaks: boolean;
          pays_buffer: boolean;
          po_number?: string | null;
          title: string;
          venue_address: string;
          venue_id?: string | null;
          venue_location: unknown;
          venue_name: string;
        };
        Update: {
          auto_assign?: boolean;
          cancel_reason?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          client_id?: string;
          created_at?: string;
          created_by?: string | null;
          event_date?: string;
          geofence_radius_m?: number;
          id?: string;
          notes?: string | null;
          onsite_contact?: string | null;
          payroll_exported_at?: string | null;
          pays_breaks?: boolean;
          pays_buffer?: boolean;
          po_number?: string | null;
          title?: string;
          venue_address?: string;
          venue_id?: string | null;
          venue_location?: unknown;
          venue_name?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'events_cancelled_by_fkey';
            columns: ['cancelled_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'events_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'client_company_v';
            referencedColumns: ['client_id'];
          },
          {
            foreignKeyName: 'events_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'clients';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'events_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'clients_directory_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'events_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'feedback_entries_v';
            referencedColumns: ['client_id'];
          },
          {
            foreignKeyName: 'events_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'events_venue_id_fkey';
            columns: ['venue_id'];
            isOneToOne: false;
            referencedRelation: 'venue_directory_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'events_venue_id_fkey';
            columns: ['venue_id'];
            isOneToOne: false;
            referencedRelation: 'venues';
            referencedColumns: ['id'];
          },
        ];
      };
      feedback: {
        Row: {
          author_id: string | null;
          author_kind: Database['public']['Enums']['feedback_author'];
          created_at: string;
          event_id: string | null;
          id: string;
          rating: number;
          read_at: string | null;
          read_by: string | null;
          staff_id: string;
          text: string | null;
          updated_at: string | null;
        };
        Insert: {
          author_id?: string | null;
          author_kind: Database['public']['Enums']['feedback_author'];
          created_at?: string;
          event_id?: string | null;
          id?: string;
          rating: number;
          read_at?: string | null;
          read_by?: string | null;
          staff_id: string;
          text?: string | null;
          updated_at?: string | null;
        };
        Update: {
          author_id?: string | null;
          author_kind?: Database['public']['Enums']['feedback_author'];
          created_at?: string;
          event_id?: string | null;
          id?: string;
          rating?: number;
          read_at?: string | null;
          read_by?: string | null;
          staff_id?: string;
          text?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'feedback_author_id_fkey';
            columns: ['author_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'feedback_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'client_events_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'feedback_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'clients_event_list_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'feedback_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'events';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'feedback_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'staff_feedback_v';
            referencedColumns: ['event_id'];
          },
          {
            foreignKeyName: 'feedback_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'staff_shift_history_v';
            referencedColumns: ['event_id'];
          },
          {
            foreignKeyName: 'feedback_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'staff_violations_v';
            referencedColumns: ['event_id'];
          },
          {
            foreignKeyName: 'feedback_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'venue_upcoming_events_v';
            referencedColumns: ['event_id'];
          },
          {
            foreignKeyName: 'feedback_read_by_fkey';
            columns: ['read_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'feedback_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'clients_qualified_staff_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'feedback_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'compliance_radar_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'feedback_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'onboarding_candidates_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'feedback_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'onboarding_returning_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'feedback_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'feedback_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_block_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'feedback_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_directory_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'feedback_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_profile_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'feedback_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_rejection_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'feedback_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'student_visa_v';
            referencedColumns: ['id'];
          },
        ];
      };
      hmrc_checklists: {
        Row: {
          declared: boolean;
          id: string;
          postgraduate_loan: boolean;
          q1_other_job: boolean;
          q2_pension: boolean | null;
          q3_since_6_april: boolean | null;
          staff_id: string;
          statement: Database['public']['Enums']['hmrc_statement'];
          student_loan: Database['public']['Enums']['student_loan_plan'];
          submitted_at: string;
          superseded: boolean;
        };
        Insert: {
          declared: boolean;
          id?: string;
          postgraduate_loan?: boolean;
          q1_other_job: boolean;
          q2_pension?: boolean | null;
          q3_since_6_april?: boolean | null;
          staff_id: string;
          statement: Database['public']['Enums']['hmrc_statement'];
          student_loan?: Database['public']['Enums']['student_loan_plan'];
          submitted_at?: string;
          superseded?: boolean;
        };
        Update: {
          declared?: boolean;
          id?: string;
          postgraduate_loan?: boolean;
          q1_other_job?: boolean;
          q2_pension?: boolean | null;
          q3_since_6_april?: boolean | null;
          staff_id?: string;
          statement?: Database['public']['Enums']['hmrc_statement'];
          student_loan?: Database['public']['Enums']['student_loan_plan'];
          submitted_at?: string;
          superseded?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'hmrc_checklists_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'clients_qualified_staff_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'hmrc_checklists_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'compliance_radar_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'hmrc_checklists_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'onboarding_candidates_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'hmrc_checklists_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'onboarding_returning_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'hmrc_checklists_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'hmrc_checklists_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_block_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'hmrc_checklists_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_directory_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'hmrc_checklists_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_profile_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'hmrc_checklists_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_rejection_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'hmrc_checklists_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'student_visa_v';
            referencedColumns: ['id'];
          },
        ];
      };
      job_runs: {
        Row: {
          counts: Json;
          error: string | null;
          finished_at: string | null;
          id: number;
          job: string;
          ok: boolean | null;
          started_at: string;
        };
        Insert: {
          counts?: Json;
          error?: string | null;
          finished_at?: string | null;
          id?: never;
          job: string;
          ok?: boolean | null;
          started_at?: string;
        };
        Update: {
          counts?: Json;
          error?: string | null;
          finished_at?: string | null;
          id?: never;
          job?: string;
          ok?: boolean | null;
          started_at?: string;
        };
        Relationships: [];
      };
      job_schedules: {
        Row: {
          base_url_source: string;
          cron_expression: string;
          edge_path: string;
          enabled: boolean;
          job: string;
          note: string | null;
          secret_name: string;
        };
        Insert: {
          base_url_source?: string;
          cron_expression: string;
          edge_path: string;
          enabled?: boolean;
          job: string;
          note?: string | null;
          secret_name?: string;
        };
        Update: {
          base_url_source?: string;
          cron_expression?: string;
          edge_path?: string;
          enabled?: boolean;
          job?: string;
          note?: string | null;
          secret_name?: string;
        };
        Relationships: [];
      };
      location_pings: {
        Row: {
          at: string;
          booking_id: string;
          id: number;
          inside_geofence: boolean;
          location: unknown;
        };
        Insert: {
          at?: string;
          booking_id: string;
          id?: never;
          inside_geofence: boolean;
          location: unknown;
        };
        Update: {
          at?: string;
          booking_id?: string;
          id?: never;
          inside_geofence?: boolean;
          location?: unknown;
        };
        Relationships: [
          {
            foreignKeyName: 'location_pings_booking_id_fkey';
            columns: ['booking_id'];
            isOneToOne: false;
            referencedRelation: 'bookings';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'location_pings_booking_id_fkey';
            columns: ['booking_id'];
            isOneToOne: false;
            referencedRelation: 'checkin_monitor_v';
            referencedColumns: ['booking_id'];
          },
          {
            foreignKeyName: 'location_pings_booking_id_fkey';
            columns: ['booking_id'];
            isOneToOne: false;
            referencedRelation: 'client_lineup_v';
            referencedColumns: ['booking_id'];
          },
          {
            foreignKeyName: 'location_pings_booking_id_fkey';
            columns: ['booking_id'];
            isOneToOne: false;
            referencedRelation: 'payable_shifts_v';
            referencedColumns: ['booking_id'];
          },
          {
            foreignKeyName: 'location_pings_booking_id_fkey';
            columns: ['booking_id'];
            isOneToOne: false;
            referencedRelation: 'staff_shift_history_v';
            referencedColumns: ['booking_id'];
          },
        ];
      };
      notification_outbox: {
        Row: {
          attempts: number;
          channel: Database['public']['Enums']['notification_channel'];
          error: string | null;
          failed_at: string | null;
          id: number;
          key: string;
          last_attempt_at: string | null;
          payload: Json;
          recipient_emails: string[] | null;
          recipient_staff_id: string | null;
          send_after: string;
          sent_at: string | null;
          template: string;
        };
        Insert: {
          attempts?: number;
          channel: Database['public']['Enums']['notification_channel'];
          error?: string | null;
          failed_at?: string | null;
          id?: never;
          key: string;
          last_attempt_at?: string | null;
          payload?: Json;
          recipient_emails?: string[] | null;
          recipient_staff_id?: string | null;
          send_after?: string;
          sent_at?: string | null;
          template: string;
        };
        Update: {
          attempts?: number;
          channel?: Database['public']['Enums']['notification_channel'];
          error?: string | null;
          failed_at?: string | null;
          id?: never;
          key?: string;
          last_attempt_at?: string | null;
          payload?: Json;
          recipient_emails?: string[] | null;
          recipient_staff_id?: string | null;
          send_after?: string;
          sent_at?: string | null;
          template?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'notification_outbox_recipient_staff_id_fkey';
            columns: ['recipient_staff_id'];
            isOneToOne: false;
            referencedRelation: 'clients_qualified_staff_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'notification_outbox_recipient_staff_id_fkey';
            columns: ['recipient_staff_id'];
            isOneToOne: false;
            referencedRelation: 'compliance_radar_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'notification_outbox_recipient_staff_id_fkey';
            columns: ['recipient_staff_id'];
            isOneToOne: false;
            referencedRelation: 'onboarding_candidates_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'notification_outbox_recipient_staff_id_fkey';
            columns: ['recipient_staff_id'];
            isOneToOne: false;
            referencedRelation: 'onboarding_returning_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'notification_outbox_recipient_staff_id_fkey';
            columns: ['recipient_staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'notification_outbox_recipient_staff_id_fkey';
            columns: ['recipient_staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_block_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'notification_outbox_recipient_staff_id_fkey';
            columns: ['recipient_staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_directory_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'notification_outbox_recipient_staff_id_fkey';
            columns: ['recipient_staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_profile_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'notification_outbox_recipient_staff_id_fkey';
            columns: ['recipient_staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_rejection_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'notification_outbox_recipient_staff_id_fkey';
            columns: ['recipient_staff_id'];
            isOneToOne: false;
            referencedRelation: 'student_visa_v';
            referencedColumns: ['id'];
          },
        ];
      };
      office_saved_views: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          owner: string;
          query: Json;
          scope: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          owner?: string;
          query: Json;
          scope?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          owner?: string;
          query?: Json;
          scope?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      onboarding_progress: {
        Row: {
          address_at: string | null;
          bank_at: string | null;
          contract_at: string | null;
          documents_at: string | null;
          hmrc_at: string | null;
          induction_at: string | null;
          references_at: string | null;
          rtw_at: string | null;
          selfie_at: string | null;
          staff_id: string;
          tutorial_at: string | null;
          uk_doc_choice: string | null;
          updated_at: string;
          visa_expiry: string | null;
          visa_type: string | null;
        };
        Insert: {
          address_at?: string | null;
          bank_at?: string | null;
          contract_at?: string | null;
          documents_at?: string | null;
          hmrc_at?: string | null;
          induction_at?: string | null;
          references_at?: string | null;
          rtw_at?: string | null;
          selfie_at?: string | null;
          staff_id: string;
          tutorial_at?: string | null;
          uk_doc_choice?: string | null;
          updated_at?: string;
          visa_expiry?: string | null;
          visa_type?: string | null;
        };
        Update: {
          address_at?: string | null;
          bank_at?: string | null;
          contract_at?: string | null;
          documents_at?: string | null;
          hmrc_at?: string | null;
          induction_at?: string | null;
          references_at?: string | null;
          rtw_at?: string | null;
          selfie_at?: string | null;
          staff_id?: string;
          tutorial_at?: string | null;
          uk_doc_choice?: string | null;
          updated_at?: string;
          visa_expiry?: string | null;
          visa_type?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'onboarding_progress_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: true;
            referencedRelation: 'clients_qualified_staff_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'onboarding_progress_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: true;
            referencedRelation: 'compliance_radar_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'onboarding_progress_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: true;
            referencedRelation: 'onboarding_candidates_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'onboarding_progress_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: true;
            referencedRelation: 'onboarding_returning_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'onboarding_progress_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: true;
            referencedRelation: 'staff';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'onboarding_progress_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: true;
            referencedRelation: 'staff_block_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'onboarding_progress_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: true;
            referencedRelation: 'staff_directory_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'onboarding_progress_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: true;
            referencedRelation: 'staff_profile_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'onboarding_progress_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: true;
            referencedRelation: 'staff_rejection_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'onboarding_progress_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: true;
            referencedRelation: 'student_visa_v';
            referencedColumns: ['id'];
          },
        ];
      };
      payroll_export_lines: {
        Row: {
          base: number | null;
          booking_id: string;
          created_at: string;
          event_id: string;
          holiday: number | null;
          id: number;
          payable_min: number | null;
          rate: number;
          report_send_id: number;
          shift_date: string;
          staff_id: string;
          state: string;
        };
        Insert: {
          base?: number | null;
          booking_id: string;
          created_at?: string;
          event_id: string;
          holiday?: number | null;
          id?: never;
          payable_min?: number | null;
          rate: number;
          report_send_id: number;
          shift_date: string;
          staff_id: string;
          state: string;
        };
        Update: {
          base?: number | null;
          booking_id?: string;
          created_at?: string;
          event_id?: string;
          holiday?: number | null;
          id?: never;
          payable_min?: number | null;
          rate?: number;
          report_send_id?: number;
          shift_date?: string;
          staff_id?: string;
          state?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'payroll_export_lines_booking_id_fkey';
            columns: ['booking_id'];
            isOneToOne: false;
            referencedRelation: 'bookings';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'payroll_export_lines_booking_id_fkey';
            columns: ['booking_id'];
            isOneToOne: false;
            referencedRelation: 'checkin_monitor_v';
            referencedColumns: ['booking_id'];
          },
          {
            foreignKeyName: 'payroll_export_lines_booking_id_fkey';
            columns: ['booking_id'];
            isOneToOne: false;
            referencedRelation: 'client_lineup_v';
            referencedColumns: ['booking_id'];
          },
          {
            foreignKeyName: 'payroll_export_lines_booking_id_fkey';
            columns: ['booking_id'];
            isOneToOne: false;
            referencedRelation: 'payable_shifts_v';
            referencedColumns: ['booking_id'];
          },
          {
            foreignKeyName: 'payroll_export_lines_booking_id_fkey';
            columns: ['booking_id'];
            isOneToOne: false;
            referencedRelation: 'staff_shift_history_v';
            referencedColumns: ['booking_id'];
          },
          {
            foreignKeyName: 'payroll_export_lines_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'client_events_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'payroll_export_lines_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'clients_event_list_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'payroll_export_lines_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'events';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'payroll_export_lines_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'staff_feedback_v';
            referencedColumns: ['event_id'];
          },
          {
            foreignKeyName: 'payroll_export_lines_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'staff_shift_history_v';
            referencedColumns: ['event_id'];
          },
          {
            foreignKeyName: 'payroll_export_lines_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'staff_violations_v';
            referencedColumns: ['event_id'];
          },
          {
            foreignKeyName: 'payroll_export_lines_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'venue_upcoming_events_v';
            referencedColumns: ['event_id'];
          },
          {
            foreignKeyName: 'payroll_export_lines_report_send_id_fkey';
            columns: ['report_send_id'];
            isOneToOne: false;
            referencedRelation: 'report_sends';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'payroll_export_lines_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'clients_qualified_staff_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'payroll_export_lines_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'compliance_radar_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'payroll_export_lines_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'onboarding_candidates_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'payroll_export_lines_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'onboarding_returning_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'payroll_export_lines_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'payroll_export_lines_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_block_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'payroll_export_lines_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_directory_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'payroll_export_lines_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_profile_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'payroll_export_lines_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_rejection_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'payroll_export_lines_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'student_visa_v';
            referencedColumns: ['id'];
          },
        ];
      };
      profiles: {
        Row: {
          client_id: string | null;
          created_at: string;
          full_name: string;
          id: string;
          office_role: Database['public']['Enums']['office_role'] | null;
          role: Database['public']['Enums']['app_role'];
        };
        Insert: {
          client_id?: string | null;
          created_at?: string;
          full_name: string;
          id: string;
          office_role?: Database['public']['Enums']['office_role'] | null;
          role: Database['public']['Enums']['app_role'];
        };
        Update: {
          client_id?: string | null;
          created_at?: string;
          full_name?: string;
          id?: string;
          office_role?: Database['public']['Enums']['office_role'] | null;
          role?: Database['public']['Enums']['app_role'];
        };
        Relationships: [];
      };
      push_subscriptions: {
        Row: {
          auth: string;
          created_at: string;
          endpoint: string;
          id: string;
          last_seen_at: string;
          p256dh: string;
          staff_id: string;
          user_agent: string | null;
        };
        Insert: {
          auth: string;
          created_at?: string;
          endpoint: string;
          id?: string;
          last_seen_at?: string;
          p256dh: string;
          staff_id: string;
          user_agent?: string | null;
        };
        Update: {
          auth?: string;
          created_at?: string;
          endpoint?: string;
          id?: string;
          last_seen_at?: string;
          p256dh?: string;
          staff_id?: string;
          user_agent?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'push_subscriptions_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'clients_qualified_staff_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'push_subscriptions_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'compliance_radar_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'push_subscriptions_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'onboarding_candidates_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'push_subscriptions_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'onboarding_returning_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'push_subscriptions_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'push_subscriptions_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_block_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'push_subscriptions_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_directory_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'push_subscriptions_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_profile_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'push_subscriptions_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_rejection_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'push_subscriptions_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'student_visa_v';
            referencedColumns: ['id'];
          },
        ];
      };
      quiz_attempts: {
        Row: {
          answers: Json;
          attempt_no: number;
          id: string;
          passed: boolean;
          score: number;
          staff_id: string;
          superseded: boolean;
          taken_at: string;
        };
        Insert: {
          answers: Json;
          attempt_no: number;
          id?: string;
          passed: boolean;
          score: number;
          staff_id: string;
          superseded?: boolean;
          taken_at?: string;
        };
        Update: {
          answers?: Json;
          attempt_no?: number;
          id?: string;
          passed?: boolean;
          score?: number;
          staff_id?: string;
          superseded?: boolean;
          taken_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'quiz_attempts_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'clients_qualified_staff_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'quiz_attempts_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'compliance_radar_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'quiz_attempts_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'onboarding_candidates_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'quiz_attempts_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'onboarding_returning_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'quiz_attempts_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'quiz_attempts_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_block_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'quiz_attempts_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_directory_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'quiz_attempts_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_profile_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'quiz_attempts_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_rejection_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'quiz_attempts_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'student_visa_v';
            referencedColumns: ['id'];
          },
        ];
      };
      quiz_questions: {
        Row: {
          active: boolean;
          correct_index: number;
          created_at: string;
          id: string;
          image_path: string | null;
          is_placeholder: boolean;
          options: string[];
          position: number;
          prompt: string;
        };
        Insert: {
          active?: boolean;
          correct_index: number;
          created_at?: string;
          id?: string;
          image_path?: string | null;
          is_placeholder?: boolean;
          options: string[];
          position: number;
          prompt: string;
        };
        Update: {
          active?: boolean;
          correct_index?: number;
          created_at?: string;
          id?: string;
          image_path?: string | null;
          is_placeholder?: boolean;
          options?: string[];
          position?: number;
          prompt?: string;
        };
        Relationships: [];
      };
      report_sends: {
        Row: {
          created_at: string;
          error: string | null;
          held_count: number | null;
          id: number;
          kind: string;
          outbox_key: string | null;
          period_end: string;
          period_start: string;
          row_count: number | null;
          sent_at: string | null;
          status: string;
          storage_path: string | null;
        };
        Insert: {
          created_at?: string;
          error?: string | null;
          held_count?: number | null;
          id?: never;
          kind: string;
          outbox_key?: string | null;
          period_end: string;
          period_start: string;
          row_count?: number | null;
          sent_at?: string | null;
          status: string;
          storage_path?: string | null;
        };
        Update: {
          created_at?: string;
          error?: string | null;
          held_count?: number | null;
          id?: never;
          kind?: string;
          outbox_key?: string | null;
          period_end?: string;
          period_start?: string;
          row_count?: number | null;
          sent_at?: string | null;
          status?: string;
          storage_path?: string | null;
        };
        Relationships: [];
      };
      roles: {
        Row: {
          created_at: string;
          description: string | null;
          id: string;
          name: string;
          pay_rate: number;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          id?: string;
          name: string;
          pay_rate: number;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          id?: string;
          name?: string;
          pay_rate?: number;
        };
        Relationships: [];
      };
      rtw_checks: {
        Row: {
          attempts: number;
          compliance_doc_id: string;
          created_at: string;
          error: string | null;
          finished_at: string | null;
          id: string;
          lease_until: string | null;
          max_attempts: number;
          next_attempt_at: string;
          outcome: string | null;
          report_path: string | null;
          requested_by: string | null;
          result: Json | null;
          review_reason: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          source: string | null;
          staff_id: string;
          started_at: string | null;
          status: string;
          updated_at: string;
          worker_reason: string | null;
        };
        Insert: {
          attempts?: number;
          compliance_doc_id: string;
          created_at?: string;
          error?: string | null;
          finished_at?: string | null;
          id?: string;
          lease_until?: string | null;
          max_attempts?: number;
          next_attempt_at?: string;
          outcome?: string | null;
          report_path?: string | null;
          requested_by?: string | null;
          result?: Json | null;
          review_reason?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          source?: string | null;
          staff_id: string;
          started_at?: string | null;
          status?: string;
          updated_at?: string;
          worker_reason?: string | null;
        };
        Update: {
          attempts?: number;
          compliance_doc_id?: string;
          created_at?: string;
          error?: string | null;
          finished_at?: string | null;
          id?: string;
          lease_until?: string | null;
          max_attempts?: number;
          next_attempt_at?: string;
          outcome?: string | null;
          report_path?: string | null;
          requested_by?: string | null;
          result?: Json | null;
          review_reason?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          source?: string | null;
          staff_id?: string;
          started_at?: string | null;
          status?: string;
          updated_at?: string;
          worker_reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'rtw_checks_compliance_doc_id_fkey';
            columns: ['compliance_doc_id'];
            isOneToOne: false;
            referencedRelation: 'compliance_docs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'rtw_checks_compliance_doc_id_fkey';
            columns: ['compliance_doc_id'];
            isOneToOne: false;
            referencedRelation: 'staff_documents_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'rtw_checks_requested_by_fkey';
            columns: ['requested_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'rtw_checks_reviewed_by_fkey';
            columns: ['reviewed_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'rtw_checks_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'clients_qualified_staff_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'rtw_checks_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'compliance_radar_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'rtw_checks_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'onboarding_candidates_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'rtw_checks_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'onboarding_returning_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'rtw_checks_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'rtw_checks_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_block_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'rtw_checks_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_directory_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'rtw_checks_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_profile_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'rtw_checks_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_rejection_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'rtw_checks_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'student_visa_v';
            referencedColumns: ['id'];
          },
        ];
      };
      settings: {
        Row: {
          key: string;
          updated_at: string;
          value: Json;
        };
        Insert: {
          key: string;
          updated_at?: string;
          value: Json;
        };
        Update: {
          key?: string;
          updated_at?: string;
          value?: Json;
        };
        Relationships: [];
      };
      shift_requirements: {
        Row: {
          allocation_per_hour: number;
          auto_assign: boolean;
          buffer: number;
          charge_rate: number;
          dress_code: string | null;
          ends_at: string;
          event_id: string;
          headcount: number;
          id: string;
          pay_rate: number;
          role_id: string;
          starts_at: string;
        };
        Insert: {
          allocation_per_hour: number;
          auto_assign?: boolean;
          buffer?: number;
          charge_rate: number;
          dress_code?: string | null;
          ends_at: string;
          event_id: string;
          headcount: number;
          id?: string;
          pay_rate: number;
          role_id: string;
          starts_at: string;
        };
        Update: {
          allocation_per_hour?: number;
          auto_assign?: boolean;
          buffer?: number;
          charge_rate?: number;
          dress_code?: string | null;
          ends_at?: string;
          event_id?: string;
          headcount?: number;
          id?: string;
          pay_rate?: number;
          role_id?: string;
          starts_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'client_events_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'clients_event_list_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'events';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'staff_feedback_v';
            referencedColumns: ['event_id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'staff_shift_history_v';
            referencedColumns: ['event_id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'staff_violations_v';
            referencedColumns: ['event_id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'venue_upcoming_events_v';
            referencedColumns: ['event_id'];
          },
          {
            foreignKeyName: 'shift_requirements_role_id_fkey';
            columns: ['role_id'];
            isOneToOne: false;
            referencedRelation: 'role_directory_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shift_requirements_role_id_fkey';
            columns: ['role_id'];
            isOneToOne: false;
            referencedRelation: 'roles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shift_requirements_role_id_fkey';
            columns: ['role_id'];
            isOneToOne: false;
            referencedRelation: 'staff_shift_history_v';
            referencedColumns: ['role_id'];
          },
        ];
      };
      spatial_ref_sys: {
        Row: {
          auth_name: string | null;
          auth_srid: number | null;
          proj4text: string | null;
          srid: number;
          srtext: string | null;
        };
        Insert: {
          auth_name?: string | null;
          auth_srid?: number | null;
          proj4text?: string | null;
          srid: number;
          srtext?: string | null;
        };
        Update: {
          auth_name?: string | null;
          auth_srid?: number | null;
          proj4text?: string | null;
          srid?: number;
          srtext?: string | null;
        };
        Relationships: [];
      };
      staff: {
        Row: {
          applied_age_band: string | null;
          below_degree_level: boolean;
          block_kind: Database['public']['Enums']['block_kind'] | null;
          block_reason: string | null;
          contract_signed_at: string | null;
          contract_version: string | null;
          course_completion_date: string | null;
          created_at: string;
          dob: string | null;
          email: string;
          employee_id: number | null;
          first_name: string;
          gdpr_consent_at: string;
          gender: string | null;
          graduated_at: string | null;
          home_address: string | null;
          home_country: string | null;
          home_location: unknown;
          home_location_stale: boolean;
          home_postcode: string | null;
          id: string;
          last_name: string;
          leave_reason: string | null;
          left_at: string | null;
          ni_number: string | null;
          onboarding_started_at: string;
          phone: string;
          photo_path: string | null;
          quiz_attempts: number;
          rating: number | null;
          rejected_at: string | null;
          rejected_by: string | null;
          rejected_from: Database['public']['Enums']['staff_status'] | null;
          rejection_cause: string | null;
          rejection_reason: string | null;
          reliability: number | null;
          removed_at: string | null;
          right_to_work_until: string | null;
          rtw_branch: Database['public']['Enums']['rtw_branch'] | null;
          share_code: string | null;
          stage_entered_at: string;
          status: Database['public']['Enums']['staff_status'];
          term_dates: unknown[];
          user_id: string | null;
          visa_weekly_hour_limit: number | null;
          willo_answers_done: number | null;
          willo_answers_total: number | null;
          willo_candidate_id: string | null;
          willo_completed_at: string | null;
          willo_decided_at: string | null;
          willo_decided_via: string | null;
          willo_decision: string | null;
          willo_invited_at: string | null;
          wtr_optout: boolean;
          wtr_optout_cancelled_from: string | null;
          wtr_optout_copy_path: string | null;
          wtr_optout_notice_days: number | null;
          wtr_optout_signed_at: string | null;
        };
        Insert: {
          applied_age_band?: string | null;
          below_degree_level?: boolean;
          block_kind?: Database['public']['Enums']['block_kind'] | null;
          block_reason?: string | null;
          contract_signed_at?: string | null;
          contract_version?: string | null;
          course_completion_date?: string | null;
          created_at?: string;
          dob?: string | null;
          email: string;
          employee_id?: number | null;
          first_name: string;
          gdpr_consent_at?: string;
          gender?: string | null;
          graduated_at?: string | null;
          home_address?: string | null;
          home_country?: string | null;
          home_location?: unknown;
          home_location_stale?: boolean;
          home_postcode?: string | null;
          id?: string;
          last_name: string;
          leave_reason?: string | null;
          left_at?: string | null;
          ni_number?: string | null;
          onboarding_started_at?: string;
          phone: string;
          photo_path?: string | null;
          quiz_attempts?: number;
          rating?: number | null;
          rejected_at?: string | null;
          rejected_by?: string | null;
          rejected_from?: Database['public']['Enums']['staff_status'] | null;
          rejection_cause?: string | null;
          rejection_reason?: string | null;
          reliability?: number | null;
          removed_at?: string | null;
          right_to_work_until?: string | null;
          rtw_branch?: Database['public']['Enums']['rtw_branch'] | null;
          share_code?: string | null;
          stage_entered_at?: string;
          status?: Database['public']['Enums']['staff_status'];
          term_dates?: unknown[];
          user_id?: string | null;
          visa_weekly_hour_limit?: number | null;
          willo_answers_done?: number | null;
          willo_answers_total?: number | null;
          willo_candidate_id?: string | null;
          willo_completed_at?: string | null;
          willo_decided_at?: string | null;
          willo_decided_via?: string | null;
          willo_decision?: string | null;
          willo_invited_at?: string | null;
          wtr_optout?: boolean;
          wtr_optout_cancelled_from?: string | null;
          wtr_optout_copy_path?: string | null;
          wtr_optout_notice_days?: number | null;
          wtr_optout_signed_at?: string | null;
        };
        Update: {
          applied_age_band?: string | null;
          below_degree_level?: boolean;
          block_kind?: Database['public']['Enums']['block_kind'] | null;
          block_reason?: string | null;
          contract_signed_at?: string | null;
          contract_version?: string | null;
          course_completion_date?: string | null;
          created_at?: string;
          dob?: string | null;
          email?: string;
          employee_id?: number | null;
          first_name?: string;
          gdpr_consent_at?: string;
          gender?: string | null;
          graduated_at?: string | null;
          home_address?: string | null;
          home_country?: string | null;
          home_location?: unknown;
          home_location_stale?: boolean;
          home_postcode?: string | null;
          id?: string;
          last_name?: string;
          leave_reason?: string | null;
          left_at?: string | null;
          ni_number?: string | null;
          onboarding_started_at?: string;
          phone?: string;
          photo_path?: string | null;
          quiz_attempts?: number;
          rating?: number | null;
          rejected_at?: string | null;
          rejected_by?: string | null;
          rejected_from?: Database['public']['Enums']['staff_status'] | null;
          rejection_cause?: string | null;
          rejection_reason?: string | null;
          reliability?: number | null;
          removed_at?: string | null;
          right_to_work_until?: string | null;
          rtw_branch?: Database['public']['Enums']['rtw_branch'] | null;
          share_code?: string | null;
          stage_entered_at?: string;
          status?: Database['public']['Enums']['staff_status'];
          term_dates?: unknown[];
          user_id?: string | null;
          visa_weekly_hour_limit?: number | null;
          willo_answers_done?: number | null;
          willo_answers_total?: number | null;
          willo_candidate_id?: string | null;
          willo_completed_at?: string | null;
          willo_decided_at?: string | null;
          willo_decided_via?: string | null;
          willo_decision?: string | null;
          willo_invited_at?: string | null;
          wtr_optout?: boolean;
          wtr_optout_cancelled_from?: string | null;
          wtr_optout_copy_path?: string | null;
          wtr_optout_notice_days?: number | null;
          wtr_optout_signed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'staff_rejected_by_fkey';
            columns: ['rejected_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      staff_references: {
        Row: {
          email: string;
          id: string;
          name: string;
          phone: string;
          relationship: string;
          seq: number;
          staff_id: string;
        };
        Insert: {
          email: string;
          id?: string;
          name: string;
          phone: string;
          relationship: string;
          seq?: number;
          staff_id: string;
        };
        Update: {
          email?: string;
          id?: string;
          name?: string;
          phone?: string;
          relationship?: string;
          seq?: number;
          staff_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'staff_references_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'clients_qualified_staff_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'staff_references_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'compliance_radar_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'staff_references_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'onboarding_candidates_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'staff_references_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'onboarding_returning_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'staff_references_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'staff_references_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_block_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'staff_references_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_directory_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'staff_references_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_profile_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'staff_references_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_rejection_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'staff_references_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'student_visa_v';
            referencedColumns: ['id'];
          },
        ];
      };
      staff_roles: {
        Row: {
          role_id: string;
          staff_id: string;
        };
        Insert: {
          role_id: string;
          staff_id: string;
        };
        Update: {
          role_id?: string;
          staff_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'staff_roles_role_id_fkey';
            columns: ['role_id'];
            isOneToOne: false;
            referencedRelation: 'role_directory_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'staff_roles_role_id_fkey';
            columns: ['role_id'];
            isOneToOne: false;
            referencedRelation: 'roles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'staff_roles_role_id_fkey';
            columns: ['role_id'];
            isOneToOne: false;
            referencedRelation: 'staff_shift_history_v';
            referencedColumns: ['role_id'];
          },
          {
            foreignKeyName: 'staff_roles_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'clients_qualified_staff_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'staff_roles_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'compliance_radar_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'staff_roles_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'onboarding_candidates_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'staff_roles_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'onboarding_returning_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'staff_roles_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'staff_roles_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_block_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'staff_roles_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_directory_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'staff_roles_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_profile_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'staff_roles_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_rejection_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'staff_roles_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'student_visa_v';
            referencedColumns: ['id'];
          },
        ];
      };
      staff_transitions: {
        Row: {
          from_status: Database['public']['Enums']['staff_status'];
          to_status: Database['public']['Enums']['staff_status'];
        };
        Insert: {
          from_status: Database['public']['Enums']['staff_status'];
          to_status: Database['public']['Enums']['staff_status'];
        };
        Update: {
          from_status?: Database['public']['Enums']['staff_status'];
          to_status?: Database['public']['Enums']['staff_status'];
        };
        Relationships: [];
      };
      storage_deletions: {
        Row: {
          attempts: number;
          bucket: string;
          deleted_at: string | null;
          error: string | null;
          id: number;
          path: string;
          prefix: boolean;
          queued_at: string;
          staff_id: string | null;
        };
        Insert: {
          attempts?: number;
          bucket: string;
          deleted_at?: string | null;
          error?: string | null;
          id?: never;
          path: string;
          prefix?: boolean;
          queued_at?: string;
          staff_id?: string | null;
        };
        Update: {
          attempts?: number;
          bucket?: string;
          deleted_at?: string | null;
          error?: string | null;
          id?: never;
          path?: string;
          prefix?: boolean;
          queued_at?: string;
          staff_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'storage_deletions_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'clients_qualified_staff_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'storage_deletions_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'compliance_radar_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'storage_deletions_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'onboarding_candidates_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'storage_deletions_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'onboarding_returning_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'storage_deletions_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'storage_deletions_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_block_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'storage_deletions_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_directory_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'storage_deletions_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_profile_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'storage_deletions_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_rejection_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'storage_deletions_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'student_visa_v';
            referencedColumns: ['id'];
          },
        ];
      };
      venue_types: {
        Row: {
          default_radius_m: number;
          key: string;
          label: string;
          sort_order: number;
        };
        Insert: {
          default_radius_m: number;
          key: string;
          label: string;
          sort_order?: number;
        };
        Update: {
          default_radius_m?: number;
          key?: string;
          label?: string;
          sort_order?: number;
        };
        Relationships: [];
      };
      venues: {
        Row: {
          address: string;
          created_at: string;
          deleted_at: string | null;
          geofence_radius_m: number;
          id: string;
          location: unknown;
          name: string;
          venue_type: string;
        };
        Insert: {
          address: string;
          created_at?: string;
          deleted_at?: string | null;
          geofence_radius_m: number;
          id?: string;
          location: unknown;
          name: string;
          venue_type: string;
        };
        Update: {
          address?: string;
          created_at?: string;
          deleted_at?: string | null;
          geofence_radius_m?: number;
          id?: string;
          location?: unknown;
          name?: string;
          venue_type?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'venues_venue_type_fkey';
            columns: ['venue_type'];
            isOneToOne: false;
            referencedRelation: 'venue_types';
            referencedColumns: ['key'];
          },
        ];
      };
      violations: {
        Row: {
          actual_finish_at: string | null;
          booking_id: string;
          detected_at: string;
          id: string;
          minutes_late: number | null;
          resolution_note: string | null;
          resolved: boolean;
          resolved_at: string | null;
          resolved_by: string | null;
          staff_id: string;
          stale_fix_review: boolean;
          type: Database['public']['Enums']['violation_type'];
        };
        Insert: {
          actual_finish_at?: string | null;
          booking_id: string;
          detected_at?: string;
          id?: string;
          minutes_late?: number | null;
          resolution_note?: string | null;
          resolved?: boolean;
          resolved_at?: string | null;
          resolved_by?: string | null;
          staff_id: string;
          stale_fix_review?: boolean;
          type: Database['public']['Enums']['violation_type'];
        };
        Update: {
          actual_finish_at?: string | null;
          booking_id?: string;
          detected_at?: string;
          id?: string;
          minutes_late?: number | null;
          resolution_note?: string | null;
          resolved?: boolean;
          resolved_at?: string | null;
          resolved_by?: string | null;
          staff_id?: string;
          stale_fix_review?: boolean;
          type?: Database['public']['Enums']['violation_type'];
        };
        Relationships: [
          {
            foreignKeyName: 'violations_booking_id_fkey';
            columns: ['booking_id'];
            isOneToOne: false;
            referencedRelation: 'bookings';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'violations_booking_id_fkey';
            columns: ['booking_id'];
            isOneToOne: false;
            referencedRelation: 'checkin_monitor_v';
            referencedColumns: ['booking_id'];
          },
          {
            foreignKeyName: 'violations_booking_id_fkey';
            columns: ['booking_id'];
            isOneToOne: false;
            referencedRelation: 'client_lineup_v';
            referencedColumns: ['booking_id'];
          },
          {
            foreignKeyName: 'violations_booking_id_fkey';
            columns: ['booking_id'];
            isOneToOne: false;
            referencedRelation: 'payable_shifts_v';
            referencedColumns: ['booking_id'];
          },
          {
            foreignKeyName: 'violations_booking_id_fkey';
            columns: ['booking_id'];
            isOneToOne: false;
            referencedRelation: 'staff_shift_history_v';
            referencedColumns: ['booking_id'];
          },
          {
            foreignKeyName: 'violations_resolved_by_fkey';
            columns: ['resolved_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'violations_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'clients_qualified_staff_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'violations_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'compliance_radar_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'violations_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'onboarding_candidates_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'violations_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'onboarding_returning_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'violations_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'violations_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_block_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'violations_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_directory_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'violations_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_profile_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'violations_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_rejection_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'violations_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'student_visa_v';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      checkin_monitor_v: {
        Row: {
          booking_id: string | null;
          breaks_count: number | null;
          check_in_at: string | null;
          check_out_at: string | null;
          ends_at: string | null;
          event_id: string | null;
          event_title: string | null;
          last_break_at: string | null;
          last_fix_at: string | null;
          last_fix_inside: boolean | null;
          late_check_out: boolean | null;
          on_day_confirmed_at: string | null;
          photo_path: string | null;
          role_name: string | null;
          shift_id: string | null;
          staff_id: string | null;
          staff_name: string | null;
          starts_at: string | null;
          status: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'bookings_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'clients_qualified_staff_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'bookings_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'compliance_radar_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'bookings_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'onboarding_candidates_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'bookings_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'onboarding_returning_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'bookings_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'bookings_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_block_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'bookings_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_directory_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'bookings_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_profile_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'bookings_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_rejection_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'bookings_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'student_visa_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'client_events_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'clients_event_list_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'events';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'staff_feedback_v';
            referencedColumns: ['event_id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'staff_shift_history_v';
            referencedColumns: ['event_id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'staff_violations_v';
            referencedColumns: ['event_id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'venue_upcoming_events_v';
            referencedColumns: ['event_id'];
          },
        ];
      };
      client_company_v: {
        Row: {
          client_id: string | null;
          name: string | null;
        };
        Insert: {
          client_id?: string | null;
          name?: string | null;
        };
        Update: {
          client_id?: string | null;
          name?: string | null;
        };
        Relationships: [];
      };
      client_event_documents_v: {
        Row: {
          event_id: string | null;
          file_name: string | null;
          id: string | null;
          issued_at: string | null;
          kind: string | null;
          storage_path: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'event_documents_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'client_events_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'event_documents_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'clients_event_list_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'event_documents_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'events';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'event_documents_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'staff_feedback_v';
            referencedColumns: ['event_id'];
          },
          {
            foreignKeyName: 'event_documents_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'staff_shift_history_v';
            referencedColumns: ['event_id'];
          },
          {
            foreignKeyName: 'event_documents_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'staff_violations_v';
            referencedColumns: ['event_id'];
          },
          {
            foreignKeyName: 'event_documents_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'venue_upcoming_events_v';
            referencedColumns: ['event_id'];
          },
        ];
      };
      client_events_v: {
        Row: {
          client_id: string | null;
          ends_at: string | null;
          event_date: string | null;
          id: string | null;
          onsite_contact: string | null;
          po_number: string | null;
          starts_at: string | null;
          status: Database['public']['Enums']['event_status'] | null;
          title: string | null;
          venue_address: string | null;
          venue_name: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'events_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'client_company_v';
            referencedColumns: ['client_id'];
          },
          {
            foreignKeyName: 'events_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'clients';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'events_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'clients_directory_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'events_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'feedback_entries_v';
            referencedColumns: ['client_id'];
          },
        ];
      };
      client_lineup_v: {
        Row: {
          booking_id: string | null;
          ends_at: string | null;
          event_id: string | null;
          feedback_given: boolean | null;
          name: string | null;
          photo_path: string | null;
          role: string | null;
          shift_id: string | null;
          sort_key: string | null;
          starts_at: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'client_events_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'clients_event_list_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'events';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'staff_feedback_v';
            referencedColumns: ['event_id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'staff_shift_history_v';
            referencedColumns: ['event_id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'staff_violations_v';
            referencedColumns: ['event_id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'venue_upcoming_events_v';
            referencedColumns: ['event_id'];
          },
        ];
      };
      client_role_sections_v: {
        Row: {
          confirmed: number | null;
          ends_at: string | null;
          event_id: string | null;
          headcount: number | null;
          role: string | null;
          shift_id: string | null;
          starts_at: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'client_events_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'clients_event_list_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'events';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'staff_feedback_v';
            referencedColumns: ['event_id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'staff_shift_history_v';
            referencedColumns: ['event_id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'staff_violations_v';
            referencedColumns: ['event_id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'venue_upcoming_events_v';
            referencedColumns: ['event_id'];
          },
        ];
      };
      clients_directory_v: {
        Row: {
          avg_margin_pct: number | null;
          contact_emails: string[] | null;
          contact_name: string | null;
          created_at: string | null;
          event_count: number | null;
          id: string | null;
          name: string | null;
          pays_breaks: boolean | null;
          pays_buffer: boolean | null;
          phone: string | null;
          rate_card_count: number | null;
          rate_card_roles: string[] | null;
          staff_contact_point: string | null;
        };
        Insert: {
          avg_margin_pct?: never;
          contact_emails?: string[] | null;
          contact_name?: string | null;
          created_at?: string | null;
          event_count?: never;
          id?: string | null;
          name?: string | null;
          pays_breaks?: boolean | null;
          pays_buffer?: boolean | null;
          phone?: string | null;
          rate_card_count?: never;
          rate_card_roles?: never;
          staff_contact_point?: string | null;
        };
        Update: {
          avg_margin_pct?: never;
          contact_emails?: string[] | null;
          contact_name?: string | null;
          created_at?: string | null;
          event_count?: never;
          id?: string | null;
          name?: string | null;
          pays_breaks?: boolean | null;
          pays_buffer?: boolean | null;
          phone?: string | null;
          rate_card_count?: never;
          rate_card_roles?: never;
          staff_contact_point?: string | null;
        };
        Relationships: [];
      };
      clients_event_list_v: {
        Row: {
          cancelled_at: string | null;
          client_id: string | null;
          ends_at: string | null;
          event_date: string | null;
          id: string | null;
          margin_gbp: number | null;
          margin_pct: number | null;
          po_number: string | null;
          roles_summary: string | null;
          section_count: number | null;
          starts_at: string | null;
          status: Database['public']['Enums']['event_status'] | null;
          title: string | null;
          venue_name: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'events_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'client_company_v';
            referencedColumns: ['client_id'];
          },
          {
            foreignKeyName: 'events_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'clients';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'events_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'clients_directory_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'events_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'feedback_entries_v';
            referencedColumns: ['client_id'];
          },
        ];
      };
      clients_margins_v: {
        Row: {
          charge_total: number | null;
          client_id: string | null;
          completed_events: number | null;
          pay_total: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'events_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'client_company_v';
            referencedColumns: ['client_id'];
          },
          {
            foreignKeyName: 'events_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'clients';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'events_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'clients_directory_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'events_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'feedback_entries_v';
            referencedColumns: ['client_id'];
          },
        ];
      };
      clients_qualified_staff_v: {
        Row: {
          client_id: string | null;
          display_name: string | null;
          do_not_return: boolean | null;
          employee_id: number | null;
          first_granted_at: string | null;
          granted_by_name: string | null;
          granted_from_event_date: string | null;
          granted_from_event_title: string | null;
          granted_how: string | null;
          last_granted_at: string | null;
          notes: string | null;
          photo_path: string | null;
          qualification_ids: string[] | null;
          rating: number | null;
          reliability: number | null;
          role_ids: string[] | null;
          role_names: string[] | null;
          staff_id: string | null;
          status: Database['public']['Enums']['staff_status'] | null;
        };
        Relationships: [
          {
            foreignKeyName: 'client_qualifications_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'client_company_v';
            referencedColumns: ['client_id'];
          },
          {
            foreignKeyName: 'client_qualifications_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'clients';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'client_qualifications_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'clients_directory_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'client_qualifications_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'feedback_entries_v';
            referencedColumns: ['client_id'];
          },
        ];
      };
      clients_rate_card_v: {
        Row: {
          base_pay_rate: number | null;
          charge_rate: number | null;
          client_id: string | null;
          dress_codes: string[] | null;
          final_pay_rate: number | null;
          id: string | null;
          margin_pct: number | null;
          margin_per_hour: number | null;
          role_description: string | null;
          role_id: string | null;
          role_name: string | null;
          section_count: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'client_rate_cards_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'client_company_v';
            referencedColumns: ['client_id'];
          },
          {
            foreignKeyName: 'client_rate_cards_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'clients';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'client_rate_cards_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'clients_directory_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'client_rate_cards_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'feedback_entries_v';
            referencedColumns: ['client_id'];
          },
          {
            foreignKeyName: 'client_rate_cards_role_id_fkey';
            columns: ['role_id'];
            isOneToOne: false;
            referencedRelation: 'role_directory_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'client_rate_cards_role_id_fkey';
            columns: ['role_id'];
            isOneToOne: false;
            referencedRelation: 'roles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'client_rate_cards_role_id_fkey';
            columns: ['role_id'];
            isOneToOne: false;
            referencedRelation: 'staff_shift_history_v';
            referencedColumns: ['role_id'];
          },
        ];
      };
      compliance_evidence_audit_v: {
        Row: {
          actor: string | null;
          actor_name: string | null;
          at: string | null;
          below_degree_level: boolean | null;
          branch: string | null;
          branch_before: string | null;
          check_outcome: string | null;
          check_source: string | null;
          completion_date: string | null;
          completion_date_claimed: string | null;
          condition: string | null;
          doc_type: string | null;
          document_id: string | null;
          effective_from: string | null;
          employee_id: number | null;
          event: string | null;
          evidence_form: string | null;
          file_path: string | null;
          id: number | null;
          notice_days: number | null;
          reason: string | null;
          record_type: string | null;
          retain_until: string | null;
          rtw_no_time_limit: boolean | null;
          rtw_until: string | null;
          rtw_until_before: string | null;
          staff_id: string | null;
          uploaded_at: string | null;
          visa_expiry: string | null;
          visa_hour_limit: number | null;
          worker: string | null;
        };
        Relationships: [];
      };
      compliance_radar_v: {
        Row: {
          block_kind: Database['public']['Enums']['block_kind'] | null;
          days_left: number | null;
          display_name: string | null;
          doc_id: string | null;
          doc_label: string | null;
          doc_type: string | null;
          employee_id: number | null;
          expires_on: string | null;
          n1_at: string | null;
          n2_at: string | null;
          n3_at: string | null;
          n4_at: string | null;
          photo_path: string | null;
          replacement_in_review: boolean | null;
          rtw_branch: Database['public']['Enums']['rtw_branch'] | null;
          staff_id: string | null;
          state: string | null;
          status: Database['public']['Enums']['staff_status'] | null;
        };
        Relationships: [];
      };
      compliance_review_queue_v: {
        Row: {
          ai_confidence: number | null;
          awarding_institution: string | null;
          below_degree_level: boolean | null;
          block_kind: Database['public']['Enums']['block_kind'] | null;
          block_reason: string | null;
          completion_date_claimed: string | null;
          conviction_date: string | null;
          declaration_details: string | null;
          declaration_source: string | null;
          display_name: string | null;
          doc_right_to_work_until: string | null;
          employee_id: number | null;
          evidence_form: string | null;
          expiry_date: string | null;
          file_path: string | null;
          gov_report_path: string | null;
          is_candidate: boolean | null;
          is_reupload: boolean | null;
          item_id: string | null;
          item_label: string | null;
          item_type: string | null;
          kind: string | null;
          manual_review_reason: string | null;
          mime_type: string | null;
          needs_manual_review: boolean | null;
          ni_number: string | null;
          photo_path: string | null;
          previous_rejection: string | null;
          review_reason: string | null;
          rtw_branch: Database['public']['Enums']['rtw_branch'] | null;
          rtw_check_attempts: number | null;
          rtw_check_conditions: Json | null;
          rtw_check_id: string | null;
          rtw_check_no_time_limit: boolean | null;
          rtw_check_outcome: string | null;
          rtw_check_reason: string | null;
          rtw_check_report_path: string | null;
          rtw_check_source: string | null;
          rtw_check_status: string | null;
          rtw_check_term_limit: number | null;
          rtw_check_until: string | null;
          rtw_checked_at: string | null;
          rtw_manual_allowed: boolean | null;
          share_code: string | null;
          size_bytes: number | null;
          staff_id: string | null;
          staff_right_to_work_until: string | null;
          status: Database['public']['Enums']['staff_status'] | null;
          submitted_at: string | null;
          term_dates: unknown[] | null;
          visa_weekly_hour_limit: number | null;
        };
        Relationships: [];
      };
      dashboard_kpis_v: {
        Row: {
          as_of: string | null;
          compliance_blocks: number | null;
          on_shift_now: number | null;
          open_positions: number | null;
          staff_available: number | null;
        };
        Relationships: [];
      };
      dashboard_sections_v: {
        Row: {
          base_rate: number | null;
          buffer: number | null;
          cancelled_at: string | null;
          cancelled_on_day: boolean | null;
          charge_rate: number | null;
          client_id: string | null;
          client_name: string | null;
          confirmed: number | null;
          ends_at: string | null;
          event_date: string | null;
          event_id: string | null;
          event_title: string | null;
          final_pay_rate: number | null;
          headcount: number | null;
          margin_per_hour: number | null;
          open_positions: number | null;
          po_number: string | null;
          role_name: string | null;
          section_hours: number | null;
          shift_id: string | null;
          starts_at: string | null;
          venue_name: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'events_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'client_company_v';
            referencedColumns: ['client_id'];
          },
          {
            foreignKeyName: 'events_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'clients';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'events_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'clients_directory_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'events_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'feedback_entries_v';
            referencedColumns: ['client_id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'client_events_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'clients_event_list_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'events';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'staff_feedback_v';
            referencedColumns: ['event_id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'staff_shift_history_v';
            referencedColumns: ['event_id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'staff_violations_v';
            referencedColumns: ['event_id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'venue_upcoming_events_v';
            referencedColumns: ['event_id'];
          },
        ];
      };
      dashboard_upcoming_v: {
        Row: {
          base_rate: number | null;
          buffer: number | null;
          cancelled_at: string | null;
          cancelled_on_day: boolean | null;
          charge_rate: number | null;
          client_id: string | null;
          client_name: string | null;
          confirmed: number | null;
          ends_at: string | null;
          event_date: string | null;
          event_ends_at: string | null;
          event_id: string | null;
          event_starts_at: string | null;
          event_title: string | null;
          final_pay_rate: number | null;
          headcount: number | null;
          margin_per_hour: number | null;
          open_positions: number | null;
          po_number: string | null;
          role_count: number | null;
          role_name: string | null;
          section_hours: number | null;
          shift_id: string | null;
          starts_at: string | null;
          venue_name: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'events_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'client_company_v';
            referencedColumns: ['client_id'];
          },
          {
            foreignKeyName: 'events_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'clients';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'events_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'clients_directory_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'events_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'feedback_entries_v';
            referencedColumns: ['client_id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'client_events_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'clients_event_list_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'events';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'staff_feedback_v';
            referencedColumns: ['event_id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'staff_shift_history_v';
            referencedColumns: ['event_id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'staff_violations_v';
            referencedColumns: ['event_id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'venue_upcoming_events_v';
            referencedColumns: ['event_id'];
          },
        ];
      };
      dashboard_week_finance_v: {
        Row: {
          base_total: number | null;
          charge_total: number | null;
          events: number | null;
          forecast_hours: number | null;
          holiday_total: number | null;
          margin_pct: number | null;
          margin_total: number | null;
          pay_total: number | null;
          week_end: string | null;
          week_start: string | null;
        };
        Relationships: [];
      };
      event_windows: {
        Row: {
          ends_at: string | null;
          event_id: string | null;
          starts_at: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'client_events_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'clients_event_list_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'events';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'staff_feedback_v';
            referencedColumns: ['event_id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'staff_shift_history_v';
            referencedColumns: ['event_id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'staff_violations_v';
            referencedColumns: ['event_id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'venue_upcoming_events_v';
            referencedColumns: ['event_id'];
          },
        ];
      };
      feedback_authors_v: {
        Row: {
          author_id: string | null;
          author_name: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'feedback_author_id_fkey';
            columns: ['author_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      feedback_entries_v: {
        Row: {
          author_id: string | null;
          author_kind: Database['public']['Enums']['feedback_author'] | null;
          author_name: string | null;
          client_id: string | null;
          client_name: string | null;
          counts_toward_rating: boolean | null;
          created_at: string | null;
          deletable: boolean | null;
          editable: boolean | null;
          employee_id: number | null;
          event_date: string | null;
          event_id: string | null;
          event_title: string | null;
          id: string | null;
          rating: number | null;
          read_at: string | null;
          read_by_name: string | null;
          role_names: string | null;
          staff_id: string | null;
          staff_name: string | null;
          staff_removed: boolean | null;
          staff_removed_at: string | null;
          text: string | null;
          unread: boolean | null;
          updated_at: string | null;
          venue_name: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'feedback_author_id_fkey';
            columns: ['author_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'feedback_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'client_events_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'feedback_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'clients_event_list_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'feedback_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'events';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'feedback_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'staff_feedback_v';
            referencedColumns: ['event_id'];
          },
          {
            foreignKeyName: 'feedback_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'staff_shift_history_v';
            referencedColumns: ['event_id'];
          },
          {
            foreignKeyName: 'feedback_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'staff_violations_v';
            referencedColumns: ['event_id'];
          },
          {
            foreignKeyName: 'feedback_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'venue_upcoming_events_v';
            referencedColumns: ['event_id'];
          },
          {
            foreignKeyName: 'feedback_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'clients_qualified_staff_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'feedback_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'compliance_radar_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'feedback_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'onboarding_candidates_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'feedback_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'onboarding_returning_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'feedback_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'feedback_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_block_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'feedback_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_directory_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'feedback_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_profile_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'feedback_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_rejection_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'feedback_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'student_visa_v';
            referencedColumns: ['id'];
          },
        ];
      };
      geography_columns: {
        Row: {
          coord_dimension: number | null;
          f_geography_column: unknown;
          f_table_catalog: unknown;
          f_table_name: unknown;
          f_table_schema: unknown;
          srid: number | null;
          type: string | null;
        };
        Relationships: [];
      };
      geometry_columns: {
        Row: {
          coord_dimension: number | null;
          f_geometry_column: unknown;
          f_table_catalog: string | null;
          f_table_name: unknown;
          f_table_schema: unknown;
          srid: number | null;
          type: string | null;
        };
        Insert: {
          coord_dimension?: number | null;
          f_geometry_column?: unknown;
          f_table_catalog?: string | null;
          f_table_name?: unknown;
          f_table_schema?: unknown;
          srid?: number | null;
          type?: string | null;
        };
        Update: {
          coord_dimension?: number | null;
          f_geometry_column?: unknown;
          f_table_catalog?: string | null;
          f_table_name?: unknown;
          f_table_schema?: unknown;
          srid?: number | null;
          type?: string | null;
        };
        Relationships: [];
      };
      onboarding_candidates_v: {
        Row: {
          activated: boolean | null;
          activated_at: string | null;
          additional_info_done_at: string | null;
          age: number | null;
          applied_age_band: string | null;
          applied_at: string | null;
          bank_saved: boolean | null;
          contract_signed_at: string | null;
          contract_version: string | null;
          declaration_answer: boolean | null;
          declaration_status: Database['public']['Enums']['review_status'] | null;
          display_name: string | null;
          dob: string | null;
          docs_missing: string[] | null;
          docs_pending: number | null;
          docs_rejected: number | null;
          docs_total: number | null;
          docs_verified: number | null;
          email: string | null;
          employee_id: number | null;
          first_name: string | null;
          gdpr_consent_at: string | null;
          hmrc_submitted_at: string | null;
          id: string | null;
          last_doc_rejected_at: string | null;
          last_name: string | null;
          ni_entered: boolean | null;
          onboarding_started_at: string | null;
          phone: string | null;
          photo_path: string | null;
          quiz_attempts_used: number | null;
          quiz_best_score: number | null;
          quiz_blockers: string[] | null;
          quiz_passed_at: string | null;
          quiz_scores: number[] | null;
          references_count: number | null;
          rejected_at: string | null;
          rejected_by_name: string | null;
          rejected_from: Database['public']['Enums']['staff_status'] | null;
          rejection_cause: string | null;
          rejection_reason: string | null;
          right_to_work_until: string | null;
          role_ids: string[] | null;
          role_names: string[] | null;
          rtw_branch: Database['public']['Enums']['rtw_branch'] | null;
          share_code: string | null;
          stage_entered_at: string | null;
          status: Database['public']['Enums']['staff_status'] | null;
          willo_answers_done: number | null;
          willo_answers_total: number | null;
          willo_completed_at: string | null;
          willo_decided_at: string | null;
          willo_decided_via: string | null;
          willo_decision: string | null;
          willo_invited_at: string | null;
          willo_linked: boolean | null;
          willo_review_url: string | null;
        };
        Relationships: [];
      };
      onboarding_returning_v: {
        Row: {
          applicant_name: string | null;
          application_id: string | null;
          applied_at: string | null;
          block_kind: Database['public']['Enums']['block_kind'] | null;
          block_reason: string | null;
          employee_id: number | null;
          existing_name: string | null;
          matched_on: string | null;
          rating: number | null;
          reliability: number | null;
          shifts_worked: number | null;
          staff_id: string | null;
          status: Database['public']['Enums']['staff_status'] | null;
        };
        Relationships: [];
      };
      payable_shifts_v: {
        Row: {
          attempted_at: string | null;
          booking_id: string | null;
          charge_rate: number | null;
          check_in_at: string | null;
          check_out_at: string | null;
          ends_at: string | null;
          event_id: string | null;
          kind: string | null;
          pay: Json | null;
          pay_rate: number | null;
          shift_id: string | null;
          staff_id: string | null;
          starts_at: string | null;
          unpaid_break_min: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'bookings_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'clients_qualified_staff_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'bookings_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'compliance_radar_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'bookings_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'onboarding_candidates_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'bookings_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'onboarding_returning_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'bookings_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'bookings_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_block_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'bookings_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_directory_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'bookings_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_profile_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'bookings_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_rejection_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'bookings_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'student_visa_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'client_events_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'clients_event_list_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'events';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'staff_feedback_v';
            referencedColumns: ['event_id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'staff_shift_history_v';
            referencedColumns: ['event_id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'staff_violations_v';
            referencedColumns: ['event_id'];
          },
          {
            foreignKeyName: 'shift_requirements_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'venue_upcoming_events_v';
            referencedColumns: ['event_id'];
          },
        ];
      };
      report_first_shifts_v: {
        Row: {
          booking_id: string | null;
          first_shift_date: string | null;
          staff_id: string | null;
          starts_at: string | null;
        };
        Relationships: [];
      };
      report_payroll_lines_v: {
        Row: {
          attempted_at: string | null;
          base: number | null;
          booking_id: string | null;
          charge_rate: number | null;
          check_in_at: string | null;
          check_out_at: string | null;
          client_name: string | null;
          early_check_out: boolean | null;
          employee_id: number | null;
          ends_at: string | null;
          event_id: string | null;
          event_title: string | null;
          floor_applied: boolean | null;
          holiday: number | null;
          invoicing: number | null;
          kind: string | null;
          late_check_in: boolean | null;
          no_check_out_unresolved: boolean | null;
          payable_min: number | null;
          photo_path: string | null;
          rate: number | null;
          removed: boolean | null;
          role_name: string | null;
          shift_date: string | null;
          shift_id: string | null;
          sort_surname: string | null;
          staff_id: string | null;
          staff_name: string | null;
          starts_at: string | null;
          status: string | null;
          total: number | null;
          unpaid_break_min: number | null;
          worked_min: number | null;
        };
        Relationships: [];
      };
      role_directory_v: {
        Row: {
          created_at: string | null;
          description: string | null;
          final_rate: number | null;
          holiday_rate: number | null;
          id: string | null;
          name: string | null;
          pay_rate: number | null;
          rate_card_count: number | null;
          section_count: number | null;
        };
        Insert: {
          created_at?: string | null;
          description?: string | null;
          final_rate?: never;
          holiday_rate?: never;
          id?: string | null;
          name?: string | null;
          pay_rate?: number | null;
          rate_card_count?: never;
          section_count?: never;
        };
        Update: {
          created_at?: string | null;
          description?: string | null;
          final_rate?: never;
          holiday_rate?: never;
          id?: string | null;
          name?: string | null;
          pay_rate?: number | null;
          rate_card_count?: never;
          section_count?: never;
        };
        Relationships: [];
      };
      rota_guard_warnings_v: {
        Row: {
          at: string | null;
          band: string | null;
          booked_hours: number | null;
          booking_id: string | null;
          cap_hours: number | null;
          employee_id: number | null;
          ends_at: string | null;
          event_title: string | null;
          id: number | null;
          shift_hours: number | null;
          staff_id: string | null;
          starts_at: string | null;
          worker: string | null;
        };
        Relationships: [];
      };
      rtw_checks_latest_v: {
        Row: {
          attempts: number | null;
          check_id: string | null;
          conditions: Json | null;
          created_at: string | null;
          document_id: string | null;
          error: string | null;
          finished_at: string | null;
          max_attempts: number | null;
          next_attempt_at: string | null;
          no_time_limit: boolean | null;
          outcome: string | null;
          record_name: string | null;
          reference_number: string | null;
          report_path: string | null;
          requested_by: string | null;
          review_reason: string | null;
          reviewed_at: string | null;
          right_to_work_until: string | null;
          source: string | null;
          staff_id: string | null;
          started_at: string | null;
          status: string | null;
          stuck: boolean | null;
          term_time_limit_hours: number | null;
          worker_reason: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'rtw_checks_compliance_doc_id_fkey';
            columns: ['document_id'];
            isOneToOne: false;
            referencedRelation: 'compliance_docs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'rtw_checks_compliance_doc_id_fkey';
            columns: ['document_id'];
            isOneToOne: false;
            referencedRelation: 'staff_documents_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'rtw_checks_requested_by_fkey';
            columns: ['requested_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'rtw_checks_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'clients_qualified_staff_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'rtw_checks_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'compliance_radar_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'rtw_checks_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'onboarding_candidates_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'rtw_checks_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'onboarding_returning_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'rtw_checks_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'rtw_checks_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_block_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'rtw_checks_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_directory_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'rtw_checks_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_profile_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'rtw_checks_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_rejection_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'rtw_checks_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'student_visa_v';
            referencedColumns: ['id'];
          },
        ];
      };
      staff_block_audit_v: {
        Row: {
          action: string | null;
          actor: string | null;
          actor_name: string | null;
          at: string | null;
          reason: string | null;
          released: number | null;
          staff_id: string | null;
          withdrawn: number | null;
        };
        Relationships: [];
      };
      staff_block_reason_v: {
        Row: {
          block_reason: string | null;
          staff_id: string | null;
        };
        Insert: {
          block_reason?: never;
          staff_id?: string | null;
        };
        Update: {
          block_reason?: never;
          staff_id?: string | null;
        };
        Relationships: [];
      };
      staff_client_qualifications_v: {
        Row: {
          client_id: string | null;
          client_name: string | null;
          do_not_return: boolean | null;
          granted_at: string | null;
          granted_by: string | null;
          granted_by_name: string | null;
          granted_from_event: string | null;
          granted_from_event_date: string | null;
          granted_from_event_title: string | null;
          granted_how: string | null;
          id: string | null;
          note: string | null;
          role_id: string | null;
          role_name: string | null;
          staff_id: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'client_qualifications_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'client_company_v';
            referencedColumns: ['client_id'];
          },
          {
            foreignKeyName: 'client_qualifications_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'clients';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'client_qualifications_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'clients_directory_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'client_qualifications_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'feedback_entries_v';
            referencedColumns: ['client_id'];
          },
          {
            foreignKeyName: 'client_qualifications_granted_by_fkey';
            columns: ['granted_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'client_qualifications_role_id_fkey';
            columns: ['role_id'];
            isOneToOne: false;
            referencedRelation: 'role_directory_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'client_qualifications_role_id_fkey';
            columns: ['role_id'];
            isOneToOne: false;
            referencedRelation: 'roles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'client_qualifications_role_id_fkey';
            columns: ['role_id'];
            isOneToOne: false;
            referencedRelation: 'staff_shift_history_v';
            referencedColumns: ['role_id'];
          },
          {
            foreignKeyName: 'client_qualifications_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'clients_qualified_staff_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'client_qualifications_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'compliance_radar_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'client_qualifications_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'onboarding_candidates_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'client_qualifications_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'onboarding_returning_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'client_qualifications_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'client_qualifications_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_block_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'client_qualifications_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_directory_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'client_qualifications_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_profile_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'client_qualifications_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_rejection_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'client_qualifications_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'student_visa_v';
            referencedColumns: ['id'];
          },
        ];
      };
      staff_directory_v: {
        Row: {
          block_kind: Database['public']['Enums']['block_kind'] | null;
          block_reason: string | null;
          display_name: string | null;
          do_not_return_clients: string[] | null;
          employee_id: number | null;
          graduated_at: string | null;
          id: string | null;
          last_shift_at: string | null;
          leave_reason: string | null;
          left_at: string | null;
          p45_requested_at: string | null;
          photo_path: string | null;
          rating: number | null;
          released_shift_count: number | null;
          reliability: number | null;
          removed: boolean | null;
          right_to_work_until: string | null;
          role_names: string[] | null;
          rtw_branch: Database['public']['Enums']['rtw_branch'] | null;
          status: Database['public']['Enums']['staff_status'] | null;
          unresolved_violations: number | null;
          weekly_booked_hours: number | null;
          weekly_cap_band: Database['public']['Enums']['cap_band'] | null;
          weekly_cap_hours: number | null;
          weekly_cap_until: string | null;
          weekly_worked_hours: number | null;
          wtr_optout: boolean | null;
        };
        Relationships: [];
      };
      staff_documents_v: {
        Row: {
          ai_confidence: number | null;
          awarding_institution: string | null;
          completion_date: string | null;
          doc_label: string | null;
          doc_type: Database['public']['Enums']['doc_type'] | null;
          expires_on: string | null;
          expiry_date: string | null;
          file_path: string | null;
          gov_report_path: string | null;
          id: string | null;
          needs_manual_review: boolean | null;
          ni_recheck: boolean | null;
          rejection_reason: string | null;
          review_status: Database['public']['Enums']['review_status'] | null;
          reviewed_at: string | null;
          reviewed_by_name: string | null;
          right_to_work_until: string | null;
          rtw_no_time_limit: boolean | null;
          share_code: string | null;
          staff_id: string | null;
          superseded: boolean | null;
          term_dates: unknown[] | null;
          uploaded_at: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'compliance_docs_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'clients_qualified_staff_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'compliance_docs_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'compliance_radar_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'compliance_docs_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'onboarding_candidates_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'compliance_docs_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'onboarding_returning_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'compliance_docs_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'compliance_docs_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_block_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'compliance_docs_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_directory_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'compliance_docs_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_profile_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'compliance_docs_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_rejection_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'compliance_docs_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'student_visa_v';
            referencedColumns: ['id'];
          },
        ];
      };
      staff_feedback_v: {
        Row: {
          author_kind: Database['public']['Enums']['feedback_author'] | null;
          author_name: string | null;
          counts_toward_rating: boolean | null;
          created_at: string | null;
          event_date: string | null;
          event_id: string | null;
          event_title: string | null;
          id: string | null;
          rating: number | null;
          read_at: string | null;
          staff_id: string | null;
          text: string | null;
          updated_at: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'feedback_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'clients_qualified_staff_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'feedback_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'compliance_radar_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'feedback_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'onboarding_candidates_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'feedback_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'onboarding_returning_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'feedback_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'feedback_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_block_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'feedback_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_directory_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'feedback_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_profile_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'feedback_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_rejection_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'feedback_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'student_visa_v';
            referencedColumns: ['id'];
          },
        ];
      };
      staff_profile_v: {
        Row: {
          bank_account_holder: string | null;
          bank_account_masked: string | null;
          bank_sort_code_masked: string | null;
          bank_updated_at: string | null;
          block_kind: Database['public']['Enums']['block_kind'] | null;
          block_reason: string | null;
          contract_signed_at: string | null;
          contract_version: string | null;
          display_name: string | null;
          do_not_return_clients: string[] | null;
          dob: string | null;
          documents_pending: number | null;
          email: string | null;
          employee_id: number | null;
          feedback_count: number | null;
          graduated_at: string | null;
          has_ni_number: boolean | null;
          hmrc_declared_at: string | null;
          hmrc_postgraduate_loan: boolean | null;
          hmrc_statement: Database['public']['Enums']['hmrc_statement'] | null;
          hmrc_student_loan: Database['public']['Enums']['student_loan_plan'] | null;
          home_address: string | null;
          id: string | null;
          joined_at: string | null;
          last_shift_at: string | null;
          leave_reason: string | null;
          left_at: string | null;
          ni_number_masked: string | null;
          no_shows: number | null;
          p45_requested_at: string | null;
          phone: string | null;
          photo_path: string | null;
          qualification_count: number | null;
          quiz_attempts: number | null;
          rating: number | null;
          released_shift_count: number | null;
          reliability: number | null;
          removed: boolean | null;
          right_to_work_until: string | null;
          role_names: string[] | null;
          rtw_branch: Database['public']['Enums']['rtw_branch'] | null;
          share_code: string | null;
          shifts_worked: number | null;
          status: Database['public']['Enums']['staff_status'] | null;
          term_dates: unknown[] | null;
          unresolved_violations: number | null;
          weekly_booked_hours: number | null;
          weekly_cap_band: Database['public']['Enums']['cap_band'] | null;
          weekly_cap_hours: number | null;
          weekly_cap_until: string | null;
          weekly_worked_hours: number | null;
          wtr_optout: boolean | null;
        };
        Relationships: [];
      };
      staff_rejection_reason_v: {
        Row: {
          rejection_reason: string | null;
          staff_id: string | null;
        };
        Insert: {
          rejection_reason?: never;
          staff_id?: string | null;
        };
        Update: {
          rejection_reason?: never;
          staff_id?: string | null;
        };
        Relationships: [];
      };
      staff_shift_history_v: {
        Row: {
          booking_id: string | null;
          booking_status: Database['public']['Enums']['booking_status'] | null;
          cancel_cause: string | null;
          check_in_at: string | null;
          check_out_at: string | null;
          client_id: string | null;
          client_name: string | null;
          ends_at: string | null;
          event_date: string | null;
          event_id: string | null;
          event_title: string | null;
          kind: string | null;
          pay: Json | null;
          role_id: string | null;
          role_name: string | null;
          self_cancelled: boolean | null;
          shift_id: string | null;
          staff_id: string | null;
          starts_at: string | null;
          unresolved_violation_count: number | null;
          venue_name: string | null;
          violation_count: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'bookings_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'clients_qualified_staff_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'bookings_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'compliance_radar_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'bookings_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'onboarding_candidates_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'bookings_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'onboarding_returning_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'bookings_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'bookings_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_block_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'bookings_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_directory_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'bookings_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_profile_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'bookings_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_rejection_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'bookings_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'student_visa_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'events_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'client_company_v';
            referencedColumns: ['client_id'];
          },
          {
            foreignKeyName: 'events_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'clients';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'events_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'clients_directory_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'events_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'feedback_entries_v';
            referencedColumns: ['client_id'];
          },
        ];
      };
      staff_violations_v: {
        Row: {
          actual_finish_at: string | null;
          booking_id: string | null;
          client_name: string | null;
          detected_at: string | null;
          ends_at: string | null;
          event_date: string | null;
          event_id: string | null;
          event_title: string | null;
          id: string | null;
          minutes_late: number | null;
          resolution_note: string | null;
          resolved: boolean | null;
          resolved_at: string | null;
          resolved_by_name: string | null;
          role_name: string | null;
          staff_id: string | null;
          starts_at: string | null;
          type: Database['public']['Enums']['violation_type'] | null;
          venue_name: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'violations_booking_id_fkey';
            columns: ['booking_id'];
            isOneToOne: false;
            referencedRelation: 'bookings';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'violations_booking_id_fkey';
            columns: ['booking_id'];
            isOneToOne: false;
            referencedRelation: 'checkin_monitor_v';
            referencedColumns: ['booking_id'];
          },
          {
            foreignKeyName: 'violations_booking_id_fkey';
            columns: ['booking_id'];
            isOneToOne: false;
            referencedRelation: 'client_lineup_v';
            referencedColumns: ['booking_id'];
          },
          {
            foreignKeyName: 'violations_booking_id_fkey';
            columns: ['booking_id'];
            isOneToOne: false;
            referencedRelation: 'payable_shifts_v';
            referencedColumns: ['booking_id'];
          },
          {
            foreignKeyName: 'violations_booking_id_fkey';
            columns: ['booking_id'];
            isOneToOne: false;
            referencedRelation: 'staff_shift_history_v';
            referencedColumns: ['booking_id'];
          },
          {
            foreignKeyName: 'violations_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'clients_qualified_staff_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'violations_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'compliance_radar_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'violations_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'onboarding_candidates_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'violations_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'onboarding_returning_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'violations_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'violations_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_block_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'violations_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_directory_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'violations_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_profile_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'violations_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_rejection_reason_v';
            referencedColumns: ['staff_id'];
          },
          {
            foreignKeyName: 'violations_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'student_visa_v';
            referencedColumns: ['id'];
          },
        ];
      };
      student_visa_v: {
        Row: {
          below_degree_level: boolean | null;
          completion_date_claimed: string | null;
          completion_effective_from: string | null;
          completion_letter_in_review: boolean | null;
          completion_letter_rejection: string | null;
          completion_letter_status: string | null;
          completion_letter_verified_at: string | null;
          course_completion_date: string | null;
          display_name: string | null;
          employee_id: number | null;
          graduated_at: string | null;
          id: string | null;
          optout_eligible: boolean | null;
          photo_path: string | null;
          right_to_work_until: string | null;
          rtw_days_left: number | null;
          status: Database['public']['Enums']['staff_status'] | null;
          term_letter_expires_at: string | null;
          term_letter_verified_at: string | null;
          weekly_booked_hours: number | null;
          weekly_cap_band: Database['public']['Enums']['cap_band'] | null;
          weekly_cap_hours: number | null;
          wtr_optout: boolean | null;
          wtr_optout_cancelled_from: string | null;
        };
        Relationships: [];
      };
      venue_directory_v: {
        Row: {
          address: string | null;
          created_at: string | null;
          default_radius_m: number | null;
          events_past: number | null;
          events_upcoming: number | null;
          geofence_radius_m: number | null;
          id: string | null;
          lat: number | null;
          lng: number | null;
          name: string | null;
          venue_type: string | null;
          venue_type_label: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'venues_venue_type_fkey';
            columns: ['venue_type'];
            isOneToOne: false;
            referencedRelation: 'venue_types';
            referencedColumns: ['key'];
          },
        ];
      };
      venue_upcoming_events_v: {
        Row: {
          event_date: string | null;
          event_id: string | null;
          title: string | null;
          venue_id: string | null;
        };
        Insert: {
          event_date?: string | null;
          event_id?: string | null;
          title?: string | null;
          venue_id?: string | null;
        };
        Update: {
          event_date?: string | null;
          event_id?: string | null;
          title?: string | null;
          venue_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'events_venue_id_fkey';
            columns: ['venue_id'];
            isOneToOne: false;
            referencedRelation: 'venue_directory_v';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'events_venue_id_fkey';
            columns: ['venue_id'];
            isOneToOne: false;
            referencedRelation: 'venues';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Functions: {
      _postgis_deprecate: {
        Args: { newname: string; oldname: string; version: string };
        Returns: undefined;
      };
      _postgis_index_extent: {
        Args: { col: string; tbl: unknown };
        Returns: unknown;
      };
      _postgis_pgsql_version: { Args: never; Returns: string };
      _postgis_scripts_pgsql_version: { Args: never; Returns: string };
      _postgis_selectivity: {
        Args: { att_name: string; geom: unknown; mode?: string; tbl: unknown };
        Returns: number;
      };
      _postgis_stats: {
        Args: { ''?: string; att_name: string; tbl: unknown };
        Returns: string;
      };
      _st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      _st_contains: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      _st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      _st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean };
      _st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean };
      _st_crosses: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      _st_dwithin: {
        Args: {
          geog1: unknown;
          geog2: unknown;
          tolerance: number;
          use_spheroid?: boolean;
        };
        Returns: boolean;
      };
      _st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean };
      _st_intersects: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      _st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown };
        Returns: number;
      };
      _st_longestline: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: unknown;
      };
      _st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: number;
      };
      _st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      _st_overlaps: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      _st_sortablehash: { Args: { geom: unknown }; Returns: number };
      _st_touches: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      _st_voronoi: {
        Args: {
          clip?: unknown;
          g1: unknown;
          return_polygons?: boolean;
          tolerance?: number;
        };
        Returns: unknown;
      };
      _st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean };
      accept_application: { Args: { p_booking: string }; Returns: Json };
      accept_invite: { Args: { p_booking: string }; Returns: Json };
      activation_link_refresh: {
        Args: { p_link: string; p_staff: string; p_user: string };
        Returns: number;
      };
      activation_preview: { Args: { p_token_hash: string }; Returns: Json };
      activation_resend_refusal: {
        Args: { p_now?: string; p_staff: string };
        Returns: string;
      };
      add_client_role: {
        Args: {
          p_charge_rate: number;
          p_client: string;
          p_dress_codes?: string[];
          p_role: string;
        };
        Returns: string;
      };
      add_office_feedback: {
        Args: {
          p_event?: string;
          p_rating: number;
          p_staff: string;
          p_text: string;
        };
        Returns: string;
      };
      add_staff_role: {
        Args: { p_role: string; p_staff: string };
        Returns: Json;
      };
      addauth: { Args: { '': string }; Returns: boolean };
      addgeometrycolumn:
        | {
            Args: {
              catalog_name: string;
              column_name: string;
              new_dim: number;
              new_srid_in: number;
              new_type: string;
              schema_name: string;
              table_name: string;
              use_typmod?: boolean;
            };
            Returns: string;
          }
        | {
            Args: {
              column_name: string;
              new_dim: number;
              new_srid: number;
              new_type: string;
              schema_name: string;
              table_name: string;
              use_typmod?: boolean;
            };
            Returns: string;
          }
        | {
            Args: {
              column_name: string;
              new_dim: number;
              new_srid: number;
              new_type: string;
              table_name: string;
              use_typmod?: boolean;
            };
            Returns: string;
          };
      apply_to_shift: {
        Args: { p_shift: string; p_staff?: string };
        Returns: Json;
      };
      approve_completion_letter: {
        Args: {
          p_completion_date: string;
          p_doc: string;
          p_visa_expiry: string;
        };
        Returns: Json;
      };
      assert_booking_transition: {
        Args: {
          p_from: Database['public']['Enums']['booking_status'];
          p_to: Database['public']['Enums']['booking_status'];
        };
        Returns: undefined;
      };
      assert_charge_rate: { Args: { p_rate: number }; Returns: undefined };
      assert_client_input: {
        Args: {
          p_contact_emails: string[];
          p_contact_name: string;
          p_name: string;
          p_phone: string;
          p_staff_contact_point: string;
        };
        Returns: undefined;
      };
      assert_office_caller: { Args: never; Returns: undefined };
      assert_reports_caller: { Args: never; Returns: undefined };
      assert_reviewer: { Args: never; Returns: string };
      assert_role_input: {
        Args: { p_name: string; p_pay_rate: number };
        Returns: undefined;
      };
      assert_staff_transition: {
        Args: {
          p_from: Database['public']['Enums']['staff_status'];
          p_to: Database['public']['Enums']['staff_status'];
        };
        Returns: undefined;
      };
      assert_venue_input: {
        Args: {
          p_address: string;
          p_lat: number;
          p_lng: number;
          p_name: string;
        };
        Returns: undefined;
      };
      attempt_check_in: {
        Args: { p_booking: string; p_lat: number; p_lng: number };
        Returns: Json;
      };
      auto_assign_candidates: {
        Args: { p_escalation?: boolean; p_shift: string };
        Returns: {
          booking_cause: string;
          booking_status: string;
          distance_km: number;
          future_shifts: number;
          gate: string;
          qualified: boolean;
          rating: number;
          reliability: number;
          staff_id: string;
          venue_times: number;
        }[];
      };
      auto_assign_due_shifts: {
        Args: { p_mode: string; p_now?: string };
        Returns: {
          allocation: number;
          event_id: string;
          shift_id: string;
          starts_at: string;
          still_short: number;
        }[];
      };
      auto_assign_first_round: { Args: { p_event: string }; Returns: Json };
      block_worker: {
        Args: {
          p_cause?: string;
          p_kind: Database['public']['Enums']['block_kind'];
          p_now?: string;
          p_reason: string;
          p_staff: string;
          p_status?: Database['public']['Enums']['staff_status'];
        };
        Returns: Json;
      };
      block_worker_manually: {
        Args: {
          p_actor?: string;
          p_now?: string;
          p_reason: string;
          p_staff: string;
        };
        Returns: Json;
      };
      booked_elsewhere_conflict: {
        Args: {
          p_cand_ends_at: string;
          p_cand_starts_at: string;
          p_cand_venue: string;
          p_gap_minutes: number;
          p_held_ends_at: string;
          p_held_starts_at: string;
          p_held_venue: string;
        };
        Returns: string;
      };
      booked_elsewhere_gap_minutes: { Args: never; Returns: number };
      booking_counts_toward_cap: {
        Args: {
          p_cancel_cause: string;
          p_cancelled_at: string;
          p_status: Database['public']['Enums']['booking_status'];
        };
        Returns: boolean;
      };
      booking_payroll_exported: {
        Args: { p_booking: string };
        Returns: boolean;
      };
      booking_push_payload: { Args: { p_booking: string }; Returns: Json };
      booking_reminder_key: {
        Args: { p_booking: string; p_code: string; p_starts_at: string };
        Returns: string;
      };
      booking_reopenable_by: {
        Args: {
          p_cause: string;
          p_status: Database['public']['Enums']['booking_status'];
        };
        Returns: string;
      };
      booking_tick: { Args: { p_now?: string }; Returns: Json };
      booking_transition_allowed: {
        Args: {
          p_from: Database['public']['Enums']['booking_status'];
          p_to: Database['public']['Enums']['booking_status'];
        };
        Returns: boolean;
      };
      booking_transitions: {
        Args: never;
        Returns: {
          from_status: Database['public']['Enums']['booking_status'];
          to_status: Database['public']['Enums']['booking_status'];
        }[];
      };
      booking_venue_point: { Args: { p_booking: string }; Returns: Json };
      break_window_minutes: {
        Args: {
          p_break_end: string;
          p_break_start: string;
          p_check_in_at: string;
          p_ends_at: string;
          p_finish_at: string;
          p_starts_at: string;
        };
        Returns: number;
      };
      can_roster: {
        Args: { p_shift_date: string; p_visa_expiry: string };
        Returns: boolean;
      };
      can_roster_staff: {
        Args: { p_shift_date: string; p_staff: string };
        Returns: boolean;
      };
      cancel_event: {
        Args: { p_event: string; p_reason: string };
        Returns: Json;
      };
      cancel_wtr_optout: { Args: { p_staff?: string }; Returns: Json };
      cap_band_label: {
        Args: { p_band: Database['public']['Enums']['cap_band'] };
        Returns: string;
      };
      cap_band_until: {
        Args: { p_date: string; p_holidays: unknown[] };
        Returns: string;
      };
      cap_term_state: {
        Args: { p_date: string; p_holidays: unknown[] };
        Returns: string;
      };
      cap_under_18: {
        Args: { p_dob: string; p_week_start: string };
        Returns: boolean;
      };
      cap_week_start: { Args: { p_date: string }; Returns: string };
      check_in_decision: {
        Args: {
          p_at: string;
          p_confirmed_at: string;
          p_ends_at: string;
          p_headcount: number;
          p_inside_geofence: boolean;
          p_slots_filled: number;
          p_starts_at: string;
          p_strict_buffer: boolean;
        };
        Returns: Json;
      };
      check_out: {
        Args: { p_booking: string; p_lat: number; p_lng: number };
        Returns: Json;
      };
      check_out_decision: {
        Args: {
          p_at: string;
          p_check_in_at: string;
          p_ends_at: string;
          p_inside_geofence: boolean;
          p_last_on_site_at: string;
          p_starts_at: string;
        };
        Returns: Json;
      };
      claim_outbox_batch: {
        Args: { p_lease?: string; p_limit?: number };
        Returns: {
          attempts: number;
          channel: Database['public']['Enums']['notification_channel'];
          error: string | null;
          failed_at: string | null;
          id: number;
          key: string;
          last_attempt_at: string | null;
          payload: Json;
          recipient_emails: string[] | null;
          recipient_staff_id: string | null;
          send_after: string;
          sent_at: string | null;
          template: string;
        }[];
        SetofOptions: {
          from: '*';
          to: 'notification_outbox';
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      claim_storage_deletions: {
        Args: { p_limit?: number };
        Returns: {
          bucket: string;
          id: number;
          path: string;
          prefix: boolean;
          staff_id: string;
        }[];
      };
      client_portal_visible: { Args: { p_client_id: string }; Returns: boolean };
      close_filled_role_applications: {
        Args: { p_shift: string };
        Returns: number;
      };
      complete_outbox_send: {
        Args: {
          p_error?: string;
          p_id: number;
          p_max_attempts?: number;
          p_ok: boolean;
        };
        Returns: undefined;
      };
      complete_storage_deletion: {
        Args: { p_error?: string; p_id: number; p_ok: boolean };
        Returns: undefined;
      };
      completion_effective_from: {
        Args: { p_completion: string; p_verified: string };
        Returns: string;
      };
      compliance_attach_rtw_report: {
        Args: { p_doc: string; p_path: string };
        Returns: Json;
      };
      compliance_blockers: {
        Args: { p_on?: string; p_staff: string };
        Returns: {
          reason: string;
        }[];
      };
      compliance_confirm_rtw_date: {
        Args: { p_doc: string; p_right_to_work_until: string };
        Returns: Json;
      };
      compliance_daily: { Args: { p_now?: string }; Returns: Json };
      compliance_daily_due: { Args: { p_now?: string }; Returns: boolean };
      compliance_reject_declaration: {
        Args: { p_declaration: string; p_reason: string };
        Returns: Json;
      };
      compliance_reject_document: {
        Args: { p_doc: string; p_reason: string };
        Returns: Json;
      };
      compliance_reject_document_as: {
        Args: { p_doc: string; p_reason: string; p_reviewer: string };
        Returns: Json;
      };
      compliance_resolve_ni_check: {
        Args: { p_doc: string; p_matches: boolean; p_reason?: string };
        Returns: Json;
      };
      compliance_set_below_degree_level: {
        Args: { p_below: boolean; p_staff: string };
        Returns: Json;
      };
      compliance_set_visa_hour_limit: {
        Args: { p_hours: number; p_staff: string };
        Returns: Json;
      };
      compliance_verify_declaration: {
        Args: { p_declaration: string; p_note?: string };
        Returns: Json;
      };
      compliance_verify_document: {
        Args: {
          p_doc: string;
          p_expiry?: string;
          p_right_to_work_until?: string;
          p_term_dates?: unknown[];
        };
        Returns: Json;
      };
      compliance_verify_document_as: {
        Args: {
          p_doc: string;
          p_expiry?: string;
          p_reviewer: string;
          p_right_to_work_until?: string;
          p_term_dates?: unknown[];
        };
        Returns: Json;
      };
      confirm_on_day: { Args: { p_booking: string }; Returns: Json };
      create_client: {
        Args: {
          p_contact_emails: string[];
          p_contact_name: string;
          p_name: string;
          p_pays_breaks: boolean;
          p_pays_buffer: boolean;
          p_phone: string;
          p_staff_contact_point: string;
        };
        Returns: string;
      };
      create_role: {
        Args: { p_description: string; p_name: string; p_pay_rate: number };
        Returns: string;
      };
      create_venue: {
        Args: {
          p_address: string;
          p_geofence_radius_m: number;
          p_lat: number;
          p_lng: number;
          p_name: string;
          p_venue_type: string;
        };
        Returns: string;
      };
      current_app_role: {
        Args: never;
        Returns: Database['public']['Enums']['app_role'];
      };
      current_client_id: { Args: never; Returns: string };
      current_compliance_docs: {
        Args: { p_staff: string };
        Returns: {
          doc_id: string;
          doc_type: Database['public']['Enums']['doc_type'];
          status: Database['public']['Enums']['review_status'];
        }[];
      };
      current_contract_version: { Args: { p_at?: string }; Returns: string };
      current_verified_docs: {
        Args: { p_staff: string };
        Returns: {
          doc_id: string;
          doc_type: Database['public']['Enums']['doc_type'];
          expires_on: string;
        }[];
      };
      declare_conviction: {
        Args: {
          p_conviction_date?: string;
          p_details: string;
          p_now?: string;
          p_staff: string;
        };
        Returns: Json;
      };
      declare_my_conviction: {
        Args: { p_conviction_date?: string; p_details: string };
        Returns: Json;
      };
      decline_invite: { Args: { p_booking: string }; Returns: Json };
      delete_feedback: { Args: { p_id: string }; Returns: Json };
      delete_role: { Args: { p_id: string }; Returns: undefined };
      delete_venue: { Args: { p_id: string }; Returns: undefined };
      deleted_account_label: {
        Args: { p_employee_id: number };
        Returns: string;
      };
      disablelongtransactions: { Args: never; Returns: string };
      doc_expires_on: {
        Args: {
          p_doc_rtw: string;
          p_doc_type: Database['public']['Enums']['doc_type'];
          p_expiry: string;
          p_staff_rtw: string;
          p_uploaded_at: string;
        };
        Returns: string;
      };
      doc_label: {
        Args: { p_doc_type: Database['public']['Enums']['doc_type'] };
        Returns: string;
      };
      dropgeometrycolumn:
        | {
            Args: {
              catalog_name: string;
              column_name: string;
              schema_name: string;
              table_name: string;
            };
            Returns: string;
          }
        | {
            Args: {
              column_name: string;
              schema_name: string;
              table_name: string;
            };
            Returns: string;
          }
        | { Args: { column_name: string; table_name: string }; Returns: string };
      dropgeometrytable:
        | {
            Args: {
              catalog_name: string;
              schema_name: string;
              table_name: string;
            };
            Returns: string;
          }
        | { Args: { schema_name: string; table_name: string }; Returns: string }
        | { Args: { table_name: string }; Returns: string };
      edge_base_url: { Args: never; Returns: string };
      enablelongtransactions: { Args: never; Returns: string };
      equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean };
      escalation_radius_miles: { Args: never; Returns: number };
      event_document_data: { Args: { p_event: string }; Returns: Json };
      event_status: {
        Args: {
          e: Database['public']['Tables']['events']['Row'];
          window_end: string;
          window_start: string;
        };
        Returns: Database['public']['Enums']['event_status'];
      };
      evidence_path_discardable: {
        Args: { p_path: string; p_staff: string };
        Returns: boolean;
      };
      evidence_upload_problem:
        | {
            Args: { p_folder: string; p_path: string; p_staff: string };
            Returns: {
              mime: string;
              problem: string;
              size_bytes: number;
            }[];
          }
        | {
            Args: {
              p_allow_heic: boolean;
              p_folder: string;
              p_path: string;
              p_staff: string;
            };
            Returns: {
              mime: string;
              problem: string;
              size_bytes: number;
            }[];
          };
      fail_outbox_send: {
        Args: { p_error: string; p_id: number };
        Returns: undefined;
      };
      feedback_counts: {
        Args: {
          p_kind: Database['public']['Enums']['feedback_author'];
          p_read_at: string;
        };
        Returns: boolean;
      };
      feedback_event_is_the_workers: {
        Args: { p_event: string; p_staff: string };
        Returns: boolean;
      };
      final_rate: { Args: { base: number }; Returns: number };
      finance_report: {
        Args: { p_by?: string; p_from: string; p_to: string };
        Returns: {
          actual_sections: number;
          base: number;
          cancelled_events: string[];
          event_count: number;
          events: string[];
          forecast_sections: number;
          group_key: string;
          group_label: string;
          holiday: number;
          invoicing: number;
          is_total: boolean;
          margin: number;
          margin_pct: number;
          payable_min: number;
          payroll: number;
          pending: number;
        }[];
      };
      finance_reports_due: { Args: { p_now?: string }; Returns: boolean };
      finish_break: { Args: { p_booking: string }; Returns: Json };
      forget_push_subscription: {
        Args: { p_endpoint: string };
        Returns: undefined;
      };
      geometry: { Args: { '': string }; Returns: unknown };
      geometry_above: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      geometry_below: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      geometry_cmp: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: number;
      };
      geometry_contained_3d: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      geometry_contains: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      geometry_contains_3d: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      geometry_distance_box: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: number;
      };
      geometry_distance_centroid: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: number;
      };
      geometry_eq: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      geometry_ge: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      geometry_gt: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      geometry_le: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      geometry_left: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      geometry_lt: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      geometry_overabove: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      geometry_overbelow: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      geometry_overlaps: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      geometry_overlaps_3d: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      geometry_overleft: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      geometry_overright: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      geometry_right: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      geometry_same: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      geometry_same_3d: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      geometry_within: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      geomfromewkt: { Args: { '': string }; Returns: unknown };
      get_back: { Args: { p_booking: string; p_note?: string }; Returns: Json };
      gettransactionid: { Args: never; Returns: unknown };
      grant_client_qualification: {
        Args: {
          p_client: string;
          p_note?: string;
          p_role: string;
          p_staff: string;
        };
        Returns: string;
      };
      grant_qualification_for_booking: {
        Args: { p_booking: string };
        Returns: string;
      };
      hmrc_statement_for: {
        Args: { p_q1: boolean; p_q2: boolean; p_q3: boolean };
        Returns: Database['public']['Enums']['hmrc_statement'];
      };
      install_job_schedules: { Args: never; Returns: number };
      invite_worker: {
        Args: {
          p_ignore_target?: boolean;
          p_shift: string;
          p_source?: Database['public']['Enums']['booking_source'];
          p_staff: string;
        };
        Returns: Json;
      };
      is_edge_base_url: { Args: { p_url: string }; Returns: boolean };
      is_office_base_url: { Args: { p_url: string }; Returns: boolean };
      is_uk_time: {
        Args: { p_hhmm: string; p_now: string; p_window?: string };
        Returns: boolean;
      };
      is_valid_share_code: { Args: { p: string }; Returns: boolean };
      job_run_finish: {
        Args: { p_counts?: Json; p_error?: string; p_id: number; p_ok: boolean };
        Returns: undefined;
      };
      job_run_start: { Args: { p_job: string }; Returns: number };
      link_staff_account: {
        Args: { p_staff: string; p_user: string };
        Returns: Json;
      };
      longtransactionsenabled: { Args: never; Returns: boolean };
      looks_like_relative: { Args: { p: string }; Returns: boolean };
      mark_feedback_read: { Args: { p_id: string }; Returns: Json };
      mark_ready: { Args: { p_booking: string }; Returns: Json };
      my_rtw_checks: {
        Args: never;
        Returns: {
          checked_at: string;
          created_at: string;
          document_id: string;
          outcome: string;
          status: string;
          worker_reason: string;
        }[];
      };
      n6_due_at: { Args: { p_starts_at: string }; Returns: string };
      n7_closes_at: { Args: { p_starts_at: string }; Returns: string };
      n7_due_at: { Args: { p_starts_at: string }; Returns: string };
      n8_link: {
        Args: { p_status: Database['public']['Enums']['staff_status'] };
        Returns: string;
      };
      new_starter_export_rows: {
        Args: { p_send: number };
        Returns: {
          country: string;
          date_of_birth: string;
          employee_id: number;
          first_shift_date: string;
          gender: string;
          hmrc_statement: string;
          home_address: string;
          ni_number: string;
          photo_path: string;
          postcode: string;
          removed: boolean;
          staff_id: string;
          staff_name: string;
          student_loan: string;
        }[];
      };
      new_starter_postcode: { Args: { p_address: string }; Returns: string };
      new_starter_report: {
        Args: { p_date: string };
        Returns: {
          country: string;
          date_of_birth: string;
          employee_id: number;
          first_shift_date: string;
          gender: string;
          hmrc_statement: string;
          home_address: string;
          ni_number: string;
          period_end: string;
          period_start: string;
          photo_path: string;
          postcode: string;
          removed: boolean;
          staff_id: string;
          staff_name: string;
          student_loan: string;
        }[];
      };
      new_starter_rows: {
        Args: { p_staff: string[] };
        Returns: {
          country: string;
          date_of_birth: string;
          employee_id: number;
          first_shift_date: string;
          gender: string;
          hmrc_statement: string;
          home_address: string;
          ni_number: string;
          photo_path: string;
          postcode: string;
          removed: boolean;
          staff_id: string;
          staff_name: string;
          student_loan: string;
        }[];
      };
      normalise_msisdn: { Args: { p: string }; Returns: string };
      normalise_share_code: { Args: { p: string }; Returns: string };
      office_base_url: { Args: never; Returns: string };
      office_invite_worker: {
        Args: { p_shift: string; p_staff: string };
        Returns: Json;
      };
      office_mark_no_show: { Args: { p_booking: string }; Returns: Json };
      office_saved_view_query_ok: {
        Args: { p_query: Json; p_scope: string };
        Returns: boolean;
      };
      office_submit_completion_letter: {
        Args: {
          p_awarding_institution?: string;
          p_completion_date: string;
          p_evidence_form: string;
          p_file_path: string;
          p_staff: string;
        };
        Returns: Json;
      };
      onboarding_accept: {
        Args: {
          p_activation_link: string;
          p_install_link: string;
          p_note: string;
          p_roles: string[];
          p_staff: string;
        };
        Returns: Json;
      };
      onboarding_accept_with_account: {
        Args: {
          p_activation_link: string;
          p_install_link: string;
          p_note: string;
          p_roles: string[];
          p_staff: string;
          p_user: string;
        };
        Returns: Json;
      };
      onboarding_accepted_docs: {
        Args: {
          p_branch: Database['public']['Enums']['rtw_branch'];
          p_uk_choice: string;
        };
        Returns: Database['public']['Enums']['doc_type'][];
      };
      onboarding_advance_if_ready: {
        Args: { p_staff: string };
        Returns: boolean;
      };
      onboarding_assert_contract_stage: {
        Args: { s: Database['public']['Tables']['staff']['Row'] };
        Returns: undefined;
      };
      onboarding_attach_document: {
        Args: {
          p_doc_type: string;
          p_file_name: string;
          p_file_size: number;
          p_mime: string;
          p_path: string;
        };
        Returns: Json;
      };
      onboarding_complete_induction: { Args: never; Returns: Json };
      onboarding_confirm_selfie: { Args: never; Returns: Json };
      onboarding_do_accept: {
        Args: {
          p_activation_link: string;
          p_at: string;
          p_install_link: string;
          p_staff: string;
          p_via: string;
        };
        Returns: undefined;
      };
      onboarding_do_reject: {
        Args: {
          p_at: string;
          p_by: string;
          p_cause: string;
          p_reason: string;
          p_staff: string;
        };
        Returns: undefined;
      };
      onboarding_documents_missing: {
        Args: { p_staff: string };
        Returns: string[];
      };
      onboarding_finish_tutorial: { Args: never; Returns: Json };
      onboarding_me: {
        Args: never;
        Returns: {
          applied_age_band: string | null;
          below_degree_level: boolean;
          block_kind: Database['public']['Enums']['block_kind'] | null;
          block_reason: string | null;
          contract_signed_at: string | null;
          contract_version: string | null;
          course_completion_date: string | null;
          created_at: string;
          dob: string | null;
          email: string;
          employee_id: number | null;
          first_name: string;
          gdpr_consent_at: string;
          gender: string | null;
          graduated_at: string | null;
          home_address: string | null;
          home_country: string | null;
          home_location: unknown;
          home_location_stale: boolean;
          home_postcode: string | null;
          id: string;
          last_name: string;
          leave_reason: string | null;
          left_at: string | null;
          ni_number: string | null;
          onboarding_started_at: string;
          phone: string;
          photo_path: string | null;
          quiz_attempts: number;
          rating: number | null;
          rejected_at: string | null;
          rejected_by: string | null;
          rejected_from: Database['public']['Enums']['staff_status'] | null;
          rejection_cause: string | null;
          rejection_reason: string | null;
          reliability: number | null;
          removed_at: string | null;
          right_to_work_until: string | null;
          rtw_branch: Database['public']['Enums']['rtw_branch'] | null;
          share_code: string | null;
          stage_entered_at: string;
          status: Database['public']['Enums']['staff_status'];
          term_dates: unknown[];
          user_id: string | null;
          visa_weekly_hour_limit: number | null;
          willo_answers_done: number | null;
          willo_answers_total: number | null;
          willo_candidate_id: string | null;
          willo_completed_at: string | null;
          willo_decided_at: string | null;
          willo_decided_via: string | null;
          willo_decision: string | null;
          willo_invited_at: string | null;
          wtr_optout: boolean;
          wtr_optout_cancelled_from: string | null;
          wtr_optout_copy_path: string | null;
          wtr_optout_notice_days: number | null;
          wtr_optout_signed_at: string | null;
        };
        SetofOptions: {
          from: '*';
          to: 'staff';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      onboarding_quiz_blockers: { Args: { p_staff: string }; Returns: string[] };
      onboarding_quiz_questions: {
        Args: never;
        Returns: {
          id: string;
          image_path: string;
          options: string[];
          prompt: string;
          question_no: number;
        }[];
      };
      onboarding_reenter_share_code: {
        Args: { p_dob?: string; p_share_code: string };
        Returns: Json;
      };
      onboarding_reject: {
        Args: { p_reason: string; p_staff: string };
        Returns: Json;
      };
      onboarding_required_docs: {
        Args: {
          p_branch: Database['public']['Enums']['rtw_branch'];
          p_uk_choice: string;
        };
        Returns: {
          accepts: Database['public']['Enums']['doc_type'][];
          req_key: string;
        }[];
      };
      onboarding_resend_activation: {
        Args: {
          p_activation_link: string;
          p_install_link: string;
          p_staff: string;
          p_user: string;
        };
        Returns: Json;
      };
      onboarding_resend_activation_check: {
        Args: { p_staff: string };
        Returns: Json;
      };
      onboarding_resolve_returning: {
        Args: { p_action: string; p_application: string; p_reason: string };
        Returns: Json;
      };
      onboarding_save_address: {
        Args: {
          p_lat: number;
          p_line: string;
          p_lng: number;
          p_postcode: string;
          p_town: string;
        };
        Returns: Json;
      };
      onboarding_save_bank: {
        Args: {
          p_account_holder: string;
          p_account_number: string;
          p_sort_code: string;
        };
        Returns: Json;
      };
      onboarding_save_references: { Args: { p_referees: Json }; Returns: Json };
      onboarding_save_right_to_work: {
        Args: {
          p_branch: string;
          p_dob: string;
          p_share_code: string;
          p_uk_doc_choice: string;
          p_visa_expiry: string;
          p_visa_type: string;
          p_wtr_optout: boolean;
        };
        Returns: Json;
      };
      onboarding_state: { Args: never; Returns: Json };
      onboarding_submit_documents: {
        Args: {
          p_conviction_date: string;
          p_details: string;
          p_has_conviction: boolean;
        };
        Returns: Json;
      };
      onboarding_uk_today: { Args: never; Returns: string };
      outbox_backoff: { Args: { p_attempt: number }; Returns: string };
      payable_minutes: {
        Args: {
          p_check_in_at: string;
          p_check_out_at: string;
          p_ends_at: string;
          p_left_early?: boolean;
          p_no_check_out?: string;
          p_starts_at: string;
          p_unpaid_break_min?: number;
        };
        Returns: Json;
      };
      payroll_export_rows: {
        Args: { p_send: number };
        Returns: {
          base: number;
          booking_id: string;
          check_in_at: string;
          check_out_at: string;
          client_name: string;
          employee_id: number;
          ends_at: string;
          event_title: string;
          holiday: number;
          in_export: boolean;
          kind: string;
          payable_min: number;
          rate: number;
          role_name: string;
          shift_date: string;
          staff_name: string;
          starts_at: string;
          total: number;
          unpaid_break_min: number;
        }[];
      };
      payroll_report: {
        Args: { p_from: string; p_to: string };
        Returns: {
          attempted_at: string;
          base: number;
          booking_id: string;
          changed_since_export: boolean;
          check_in_at: string;
          check_out_at: string;
          client_name: string;
          early_check_out: boolean;
          employee_id: number;
          ends_at: string;
          event_id: string;
          event_title: string;
          exported_at: string;
          exported_payable_min: number;
          exported_total: number;
          floor_applied: boolean;
          holiday: number;
          in_export: boolean;
          kind: string;
          late_check_in: boolean;
          no_check_out_unresolved: boolean;
          payable_min: number;
          photo_path: string;
          rate: number;
          removed: boolean;
          role_name: string;
          shift_date: string;
          shift_id: string;
          sort_surname: string;
          staff_id: string;
          staff_name: string;
          starts_at: string;
          status: string;
          total: number;
          unpaid_break_min: number;
          worked_min: number;
        }[];
      };
      payroll_report_people: {
        Args: { p_from: string; p_to: string };
        Returns: {
          base: number;
          break_min: number;
          changed_since_export: number;
          employee_id: number;
          holiday: number;
          is_total: boolean;
          payable_min: number;
          pending: number;
          photo_path: string;
          removed: boolean;
          shifts: number;
          staff_id: string;
          staff_name: string;
          total: number;
          turned_away: number;
          workers: number;
        }[];
      };
      populate_geometry_columns:
        | { Args: { tbl_oid: unknown; use_typmod?: boolean }; Returns: number }
        | { Args: { use_typmod?: boolean }; Returns: string };
      postgis_constraint_dims: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string };
        Returns: number;
      };
      postgis_constraint_srid: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string };
        Returns: number;
      };
      postgis_constraint_type: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string };
        Returns: string;
      };
      postgis_extensions_upgrade: { Args: never; Returns: string };
      postgis_full_version: { Args: never; Returns: string };
      postgis_geos_version: { Args: never; Returns: string };
      postgis_lib_build_date: { Args: never; Returns: string };
      postgis_lib_revision: { Args: never; Returns: string };
      postgis_lib_version: { Args: never; Returns: string };
      postgis_libjson_version: { Args: never; Returns: string };
      postgis_liblwgeom_version: { Args: never; Returns: string };
      postgis_libprotobuf_version: { Args: never; Returns: string };
      postgis_libxml_version: { Args: never; Returns: string };
      postgis_proj_version: { Args: never; Returns: string };
      postgis_scripts_build_date: { Args: never; Returns: string };
      postgis_scripts_installed: { Args: never; Returns: string };
      postgis_scripts_released: { Args: never; Returns: string };
      postgis_svn_version: { Args: never; Returns: string };
      postgis_type_name: {
        Args: {
          coord_dimension: number;
          geomname: string;
          use_new_name?: boolean;
        };
        Returns: string;
      };
      postgis_version: { Args: never; Returns: string };
      postgis_wagyu_version: { Args: never; Returns: string };
      prepare_finance_reports: { Args: { p_now?: string }; Returns: Json };
      queue_application_push: {
        Args: { p_booking: string; p_code: string };
        Returns: undefined;
      };
      queue_booking_push: {
        Args: { p_booking: string; p_code: string };
        Returns: undefined;
      };
      queue_contact_change: {
        Args: { p_staff: string; p_what: string };
        Returns: undefined;
      };
      queue_event_document_email: {
        Args: { p_document: string };
        Returns: Json;
      };
      queue_finance_report_email: {
        Args: {
          p_new_starter_path?: string;
          p_payroll_path: string;
          p_payroll_send: number;
        };
        Returns: Json;
      };
      queue_office_notifications: { Args: { p_rows: Json }; Returns: number };
      queue_self_cancel_email: {
        Args: { p_at: string; p_booking: string };
        Returns: undefined;
      };
      radar_wave1_exhausted: { Args: { p_shift: string }; Returns: boolean };
      ready_cutoff_applies: {
        Args: { p_confirmed_at: string; p_starts_at: string };
        Returns: boolean;
      };
      ready_deadline: { Args: { p_starts_at: string }; Returns: string };
      recompute_staff_rating: { Args: { p_staff: string }; Returns: number };
      reconfirm_booking: { Args: { p_booking: string }; Returns: Json };
      record_document_extraction: {
        Args: {
          p_completion: string;
          p_confidence: number;
          p_doc: string;
          p_expiry: string;
          p_institution: string;
          p_raw: Json;
          p_term_dates: unknown[];
        };
        Returns: Json;
      };
      record_event_document: {
        Args: {
          p_event: string;
          p_file_name: string;
          p_kind: string;
          p_pages: number;
          p_rows: number;
          p_storage_path: string;
        };
        Returns: string;
      };
      record_ping: {
        Args: { p_booking: string; p_lat: number; p_lng: number };
        Returns: Json;
      };
      record_right_to_work_change: {
        Args: {
          p_branch: Database['public']['Enums']['rtw_branch'];
          p_share_code?: string;
          p_staff: string;
          p_until: string;
        };
        Returns: Json;
      };
      reject_declaration: {
        Args: { p_declaration: string; p_reason: string };
        Returns: Json;
      };
      reject_document: {
        Args: { p_doc: string; p_reason: string };
        Returns: Json;
      };
      release_outbox_claim: {
        Args: { p_error: string; p_id: number; p_retry_in?: string };
        Returns: undefined;
      };
      release_unready_bookings: { Args: { p_now?: string }; Returns: number };
      released_shift_lines: {
        Args: { p_at: string; p_cause: string; p_staff: string };
        Returns: string;
      };
      remove_client_role: { Args: { p_id: string }; Returns: Json };
      remove_staff_role: {
        Args: { p_role: string; p_staff: string };
        Returns: Json;
      };
      remove_worker: {
        Args: { p_actor?: string; p_now?: string; p_staff: string };
        Returns: Json;
      };
      report_week_start: { Args: { p_now?: string }; Returns: string };
      request_my_p45: { Args: { p_reason?: string }; Returns: Json };
      request_p45: {
        Args: { p_now?: string; p_reason?: string; p_staff: string };
        Returns: Json;
      };
      reset_to_candidate: {
        Args: {
          p_actor?: string;
          p_now?: string;
          p_reason: string;
          p_staff: string;
        };
        Returns: Json;
      };
      resolve_violation: {
        Args: {
          p_actual_finish?: string;
          p_arrived_at?: string;
          p_note: string;
          p_violation: string;
        };
        Returns: Json;
      };
      retained_storage_paths: { Args: { p_staff: string }; Returns: string[] };
      retry_finance_report: { Args: { p_send: number }; Returns: Json };
      revoke_client_qualification: { Args: { p_id: string }; Returns: Json };
      rota_guard_decide: {
        Args: {
          p_band: Database['public']['Enums']['cap_band'];
          p_booked: number;
          p_can_roster: boolean;
          p_cap_hours: number;
          p_mode: string;
          p_shift_hours: number;
        };
        Returns: {
          reason: string;
          verdict: string;
        }[];
      };
      rota_guard_hint: { Args: { p_reason: string }; Returns: string };
      rota_guard_mode: { Args: never; Returns: string };
      rota_guard_verdict: {
        Args: { p_shift: string; p_staff: string };
        Returns: Json;
      };
      rota_guard_verdict_at: {
        Args: {
          p_ends: string;
          p_shift: string;
          p_staff: string;
          p_starts: string;
        };
        Returns: Json;
      };
      rtw_check_backoff: { Args: { p_attempt: number }; Returns: string };
      rtw_check_claim: {
        Args: { p_lease_seconds?: number; p_limit?: number };
        Returns: {
          attempt: number;
          below_degree_level: boolean;
          check_id: string;
          date_of_birth: string;
          document_id: string;
          first_name: string;
          last_name: string;
          max_attempts: number;
          rtw_branch: string;
          share_code: string;
          staff_id: string;
        }[];
      };
      rtw_check_clean_error: {
        Args: { p_error: string; p_share_code: string };
        Returns: string;
      };
      rtw_check_clean_result: {
        Args: { p_result: Json; p_share_code: string };
        Returns: Json;
      };
      rtw_check_config: { Args: never; Returns: Json };
      rtw_check_enabled: { Args: never; Returns: boolean };
      rtw_check_enqueue: {
        Args: { p_doc: string; p_requested_by?: string };
        Returns: string;
      };
      rtw_check_manual_allowed: { Args: { p_doc: string }; Returns: boolean };
      rtw_check_mark_reviewed: { Args: { p_check: string }; Returns: Json };
      rtw_check_nudge: { Args: never; Returns: undefined };
      rtw_check_record: {
        Args: {
          p_check: string;
          p_decision: Json;
          p_error?: string;
          p_report_path?: string;
          p_result: Json;
        };
        Returns: Json;
      };
      rtw_check_request: { Args: { p_doc: string }; Returns: Json };
      rtw_check_stale_after: { Args: never; Returns: string };
      rtw_check_stuck: {
        Args: {
          p_lease_until: string;
          p_next_attempt_at: string;
          p_started_at: string;
          p_status: string;
        };
        Returns: boolean;
      };
      rtw_check_transitions: {
        Args: never;
        Returns: {
          from_status: string;
          to_status: string;
        }[];
      };
      rtw_daily: { Args: { p_now?: string }; Returns: Json };
      rtw_date_clear_allowed: { Args: never; Returns: boolean };
      rtw_doc_until: {
        Args: {
          p_doc_type: Database['public']['Enums']['doc_type'];
          p_expiry: string;
          p_right_to_work_until: string;
        };
        Returns: string;
      };
      rtw_evidence_until: { Args: { p_staff: string }; Returns: string };
      save_push_subscription: {
        Args: {
          p_auth: string;
          p_endpoint: string;
          p_p256dh: string;
          p_replaces?: string;
          p_user_agent?: string;
        };
        Returns: undefined;
      };
      self_cancel_booking: { Args: { p_booking: string }; Returns: Json };
      set_do_not_return: {
        Args: { p_id: string; p_on: boolean; p_reason?: string };
        Returns: Json;
      };
      shift_base_pay: {
        Args: { p_payable_min: number; p_rate: number };
        Returns: number;
      };
      shift_fill: {
        Args: { p_shift: string };
        Returns: {
          buffer: number;
          confirmed: number;
          headcount: number;
          invited: number;
          still_short: number;
          target: number;
        }[];
      };
      shift_holiday_pay: { Args: { p_base: number }; Returns: number };
      sign_contract: {
        Args: { p_agree: boolean; p_version: string };
        Returns: Json;
      };
      sign_wtr_optout: {
        Args: {
          p_notice_days?: number;
          p_signed_copy_path?: string;
          p_staff?: string;
        };
        Returns: Json;
      };
      st_3dclosestpoint: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: unknown;
      };
      st_3ddistance: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: number;
      };
      st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      st_3dlongestline: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: unknown;
      };
      st_3dmakebox: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: unknown;
      };
      st_3dmaxdistance: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: number;
      };
      st_3dshortestline: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: unknown;
      };
      st_addpoint: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: unknown;
      };
      st_angle:
        | { Args: { line1: unknown; line2: unknown }; Returns: number }
        | {
            Args: { pt1: unknown; pt2: unknown; pt3: unknown; pt4?: unknown };
            Returns: number;
          };
      st_area:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { '': string }; Returns: number };
      st_asencodedpolyline: {
        Args: { geom: unknown; nprecision?: number };
        Returns: string;
      };
      st_asewkt: { Args: { '': string }; Returns: string };
      st_asgeojson:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; options?: number };
            Returns: string;
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number };
            Returns: string;
          }
        | {
            Args: {
              geom_column?: string;
              maxdecimaldigits?: number;
              pretty_bool?: boolean;
              r: Record<string, unknown>;
            };
            Returns: string;
          }
        | { Args: { '': string }; Returns: string };
      st_asgml:
        | {
            Args: {
              geog: unknown;
              id?: string;
              maxdecimaldigits?: number;
              nprefix?: string;
              options?: number;
            };
            Returns: string;
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number };
            Returns: string;
          }
        | { Args: { '': string }; Returns: string }
        | {
            Args: {
              geog: unknown;
              id?: string;
              maxdecimaldigits?: number;
              nprefix?: string;
              options?: number;
              version: number;
            };
            Returns: string;
          }
        | {
            Args: {
              geom: unknown;
              id?: string;
              maxdecimaldigits?: number;
              nprefix?: string;
              options?: number;
              version: number;
            };
            Returns: string;
          };
      st_askml:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; nprefix?: string };
            Returns: string;
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; nprefix?: string };
            Returns: string;
          }
        | { Args: { '': string }; Returns: string };
      st_aslatlontext: {
        Args: { geom: unknown; tmpl?: string };
        Returns: string;
      };
      st_asmarc21: { Args: { format?: string; geom: unknown }; Returns: string };
      st_asmvtgeom: {
        Args: {
          bounds: unknown;
          buffer?: number;
          clip_geom?: boolean;
          extent?: number;
          geom: unknown;
        };
        Returns: unknown;
      };
      st_assvg:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; rel?: number };
            Returns: string;
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; rel?: number };
            Returns: string;
          }
        | { Args: { '': string }; Returns: string };
      st_astext: { Args: { '': string }; Returns: string };
      st_astwkb:
        | {
            Args: {
              geom: unknown;
              prec?: number;
              prec_m?: number;
              prec_z?: number;
              with_boxes?: boolean;
              with_sizes?: boolean;
            };
            Returns: string;
          }
        | {
            Args: {
              geom: unknown[];
              ids: number[];
              prec?: number;
              prec_m?: number;
              prec_z?: number;
              with_boxes?: boolean;
              with_sizes?: boolean;
            };
            Returns: string;
          };
      st_asx3d: {
        Args: { geom: unknown; maxdecimaldigits?: number; options?: number };
        Returns: string;
      };
      st_azimuth:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: number }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number };
      st_boundingdiagonal: {
        Args: { fits?: boolean; geom: unknown };
        Returns: unknown;
      };
      st_buffer:
        | {
            Args: { geom: unknown; options?: string; radius: number };
            Returns: unknown;
          }
        | {
            Args: { geom: unknown; quadsegs: number; radius: number };
            Returns: unknown;
          };
      st_centroid: { Args: { '': string }; Returns: unknown };
      st_clipbybox2d: {
        Args: { box: unknown; geom: unknown };
        Returns: unknown;
      };
      st_closestpoint: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: unknown;
      };
      st_collect: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown };
      st_concavehull: {
        Args: {
          param_allow_holes?: boolean;
          param_geom: unknown;
          param_pctconvex: number;
        };
        Returns: unknown;
      };
      st_contains: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      st_coorddim: { Args: { geometry: unknown }; Returns: number };
      st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean };
      st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean };
      st_crosses: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean };
      st_curvetoline: {
        Args: { flags?: number; geom: unknown; tol?: number; toltype?: number };
        Returns: unknown;
      };
      st_delaunaytriangles: {
        Args: { flags?: number; g1: unknown; tolerance?: number };
        Returns: unknown;
      };
      st_difference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number };
        Returns: unknown;
      };
      st_disjoint: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      st_distance:
        | {
            Args: { geog1: unknown; geog2: unknown; use_spheroid?: boolean };
            Returns: number;
          }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number };
      st_distancesphere:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
        | {
            Args: { geom1: unknown; geom2: unknown; radius: number };
            Returns: number;
          };
      st_distancespheroid: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: number;
      };
      st_dwithin: {
        Args: {
          geog1: unknown;
          geog2: unknown;
          tolerance: number;
          use_spheroid?: boolean;
        };
        Returns: boolean;
      };
      st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean };
      st_expand:
        | { Args: { box: unknown; dx: number; dy: number }; Returns: unknown }
        | {
            Args: { box: unknown; dx: number; dy: number; dz?: number };
            Returns: unknown;
          }
        | {
            Args: {
              dm?: number;
              dx: number;
              dy: number;
              dz?: number;
              geom: unknown;
            };
            Returns: unknown;
          };
      st_force3d: { Args: { geom: unknown; zvalue?: number }; Returns: unknown };
      st_force3dm: {
        Args: { geom: unknown; mvalue?: number };
        Returns: unknown;
      };
      st_force3dz: {
        Args: { geom: unknown; zvalue?: number };
        Returns: unknown;
      };
      st_force4d: {
        Args: { geom: unknown; mvalue?: number; zvalue?: number };
        Returns: unknown;
      };
      st_generatepoints:
        | { Args: { area: unknown; npoints: number }; Returns: unknown }
        | {
            Args: { area: unknown; npoints: number; seed: number };
            Returns: unknown;
          };
      st_geogfromtext: { Args: { '': string }; Returns: unknown };
      st_geographyfromtext: { Args: { '': string }; Returns: unknown };
      st_geohash:
        | { Args: { geog: unknown; maxchars?: number }; Returns: string }
        | { Args: { geom: unknown; maxchars?: number }; Returns: string };
      st_geomcollfromtext: { Args: { '': string }; Returns: unknown };
      st_geometricmedian: {
        Args: {
          fail_if_not_converged?: boolean;
          g: unknown;
          max_iter?: number;
          tolerance?: number;
        };
        Returns: unknown;
      };
      st_geometryfromtext: { Args: { '': string }; Returns: unknown };
      st_geomfromewkt: { Args: { '': string }; Returns: unknown };
      st_geomfromgeojson:
        | { Args: { '': Json }; Returns: unknown }
        | { Args: { '': Json }; Returns: unknown }
        | { Args: { '': string }; Returns: unknown };
      st_geomfromgml: { Args: { '': string }; Returns: unknown };
      st_geomfromkml: { Args: { '': string }; Returns: unknown };
      st_geomfrommarc21: { Args: { marc21xml: string }; Returns: unknown };
      st_geomfromtext: { Args: { '': string }; Returns: unknown };
      st_gmltosql: { Args: { '': string }; Returns: unknown };
      st_hasarc: { Args: { geometry: unknown }; Returns: boolean };
      st_hausdorffdistance: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: number;
      };
      st_hexagon: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number };
        Returns: unknown;
      };
      st_hexagongrid: {
        Args: { bounds: unknown; size: number };
        Returns: Record<string, unknown>[];
      };
      st_interpolatepoint: {
        Args: { line: unknown; point: unknown };
        Returns: number;
      };
      st_intersection: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number };
        Returns: unknown;
      };
      st_intersects:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean };
      st_isvaliddetail: {
        Args: { flags?: number; geom: unknown };
        Returns: Database['public']['CompositeTypes']['valid_detail'];
        SetofOptions: {
          from: '*';
          to: 'valid_detail';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      st_length:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { '': string }; Returns: number };
      st_letters: { Args: { font?: Json; letters: string }; Returns: unknown };
      st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown };
        Returns: number;
      };
      st_linefromencodedpolyline: {
        Args: { nprecision?: number; txtin: string };
        Returns: unknown;
      };
      st_linefromtext: { Args: { '': string }; Returns: unknown };
      st_linelocatepoint: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: number;
      };
      st_linetocurve: { Args: { geometry: unknown }; Returns: unknown };
      st_locatealong: {
        Args: { geometry: unknown; leftrightoffset?: number; measure: number };
        Returns: unknown;
      };
      st_locatebetween: {
        Args: {
          frommeasure: number;
          geometry: unknown;
          leftrightoffset?: number;
          tomeasure: number;
        };
        Returns: unknown;
      };
      st_locatebetweenelevations: {
        Args: { fromelevation: number; geometry: unknown; toelevation: number };
        Returns: unknown;
      };
      st_longestline: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: unknown;
      };
      st_makebox2d: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: unknown;
      };
      st_makeline: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: unknown;
      };
      st_makevalid: {
        Args: { geom: unknown; params: string };
        Returns: unknown;
      };
      st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: number;
      };
      st_minimumboundingcircle: {
        Args: { inputgeom: unknown; segs_per_quarter?: number };
        Returns: unknown;
      };
      st_mlinefromtext: { Args: { '': string }; Returns: unknown };
      st_mpointfromtext: { Args: { '': string }; Returns: unknown };
      st_mpolyfromtext: { Args: { '': string }; Returns: unknown };
      st_multilinestringfromtext: { Args: { '': string }; Returns: unknown };
      st_multipointfromtext: { Args: { '': string }; Returns: unknown };
      st_multipolygonfromtext: { Args: { '': string }; Returns: unknown };
      st_node: { Args: { g: unknown }; Returns: unknown };
      st_normalize: { Args: { geom: unknown }; Returns: unknown };
      st_offsetcurve: {
        Args: { distance: number; line: unknown; params?: string };
        Returns: unknown;
      };
      st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      st_overlaps: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      st_perimeter: {
        Args: { geog: unknown; use_spheroid?: boolean };
        Returns: number;
      };
      st_pointfromtext: { Args: { '': string }; Returns: unknown };
      st_pointm: {
        Args: {
          mcoordinate: number;
          srid?: number;
          xcoordinate: number;
          ycoordinate: number;
        };
        Returns: unknown;
      };
      st_pointz: {
        Args: {
          srid?: number;
          xcoordinate: number;
          ycoordinate: number;
          zcoordinate: number;
        };
        Returns: unknown;
      };
      st_pointzm: {
        Args: {
          mcoordinate: number;
          srid?: number;
          xcoordinate: number;
          ycoordinate: number;
          zcoordinate: number;
        };
        Returns: unknown;
      };
      st_polyfromtext: { Args: { '': string }; Returns: unknown };
      st_polygonfromtext: { Args: { '': string }; Returns: unknown };
      st_project: {
        Args: { azimuth: number; distance: number; geog: unknown };
        Returns: unknown;
      };
      st_quantizecoordinates: {
        Args: {
          g: unknown;
          prec_m?: number;
          prec_x: number;
          prec_y?: number;
          prec_z?: number;
        };
        Returns: unknown;
      };
      st_reduceprecision: {
        Args: { geom: unknown; gridsize: number };
        Returns: unknown;
      };
      st_relate: { Args: { geom1: unknown; geom2: unknown }; Returns: string };
      st_removerepeatedpoints: {
        Args: { geom: unknown; tolerance?: number };
        Returns: unknown;
      };
      st_segmentize: {
        Args: { geog: unknown; max_segment_length: number };
        Returns: unknown;
      };
      st_setsrid:
        | { Args: { geog: unknown; srid: number }; Returns: unknown }
        | { Args: { geom: unknown; srid: number }; Returns: unknown };
      st_sharedpaths: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: unknown;
      };
      st_shortestline: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: unknown;
      };
      st_simplifypolygonhull: {
        Args: { geom: unknown; is_outer?: boolean; vertex_fraction: number };
        Returns: unknown;
      };
      st_split: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown };
      st_square: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number };
        Returns: unknown;
      };
      st_squaregrid: {
        Args: { bounds: unknown; size: number };
        Returns: Record<string, unknown>[];
      };
      st_srid:
        { Args: { geog: unknown }; Returns: number } | { Args: { geom: unknown }; Returns: number };
      st_subdivide: {
        Args: { geom: unknown; gridsize?: number; maxvertices?: number };
        Returns: unknown[];
      };
      st_swapordinates: {
        Args: { geom: unknown; ords: unknown };
        Returns: unknown;
      };
      st_symdifference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number };
        Returns: unknown;
      };
      st_symmetricdifference: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: unknown;
      };
      st_tileenvelope: {
        Args: {
          bounds?: unknown;
          margin?: number;
          x: number;
          y: number;
          zoom: number;
        };
        Returns: unknown;
      };
      st_touches: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean };
      st_transform:
        | {
            Args: { from_proj: string; geom: unknown; to_proj: string };
            Returns: unknown;
          }
        | {
            Args: { from_proj: string; geom: unknown; to_srid: number };
            Returns: unknown;
          }
        | { Args: { geom: unknown; to_proj: string }; Returns: unknown };
      st_triangulatepolygon: { Args: { g1: unknown }; Returns: unknown };
      st_union:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
        | {
            Args: { geom1: unknown; geom2: unknown; gridsize: number };
            Returns: unknown;
          };
      st_voronoilines: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number };
        Returns: unknown;
      };
      st_voronoipolygons: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number };
        Returns: unknown;
      };
      st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean };
      st_wkbtosql: { Args: { wkb: string }; Returns: unknown };
      st_wkttosql: { Args: { '': string }; Returns: unknown };
      st_wrapx: {
        Args: { geom: unknown; move: number; wrap: number };
        Returns: unknown;
      };
      staff_account_activated: { Args: { p_staff: string }; Returns: boolean };
      staff_account_activated_at: { Args: { p_staff: string }; Returns: string };
      staff_bookings: {
        Args: { p_staff?: string };
        Returns: {
          applied_at: string;
          booked_hours: number;
          booking_id: string;
          buffer: number;
          cancel_cause: string;
          cancelled_at: string;
          cap_hours: number;
          confirmed_at: string;
          confirmed_count: number;
          created_at: string;
          day_before_confirmed_at: string;
          distance_km: number;
          dress_code: string;
          ends_at: string;
          event_cancelled_at: string;
          event_date: string;
          event_id: string;
          event_title: string;
          headcount: number;
          hours_limit: boolean;
          no_checkout_open: boolean;
          notes: string;
          on_day_confirmed_at: string;
          onsite_contact: string;
          pay_rate: number;
          pays_breaks: boolean;
          reconfirm_reason: string;
          reconfirm_required: boolean;
          role: string;
          shift_id: string;
          source: string;
          starts_at: string;
          status: string;
          venue_address: string;
          venue_name: string;
          week_start: string;
        }[];
      };
      staff_caller: { Args: { p_staff?: string }; Returns: string };
      staff_documents: { Args: { p_staff?: string }; Returns: Json };
      staff_earnings: {
        Args: never;
        Returns: {
          booking_id: string;
          check_in_at: string;
          check_out_at: string;
          ends_at: string;
          event_title: string;
          left_early: boolean;
          no_check_out: string;
          pay_date: string;
          pay_rate: number;
          payable: Json;
          role_name: string;
          starts_at: string;
          unpaid_break_min: number;
          venue_address: string;
          venue_name: string;
        }[];
      };
      staff_me: { Args: never; Returns: Json };
      staff_open_shifts: {
        Args: { p_staff?: string };
        Returns: {
          applied_at: string;
          booked_hours: number;
          buffer: number;
          cap_hours: number;
          confirmed_count: number;
          distance_km: number;
          dress_code: string;
          ends_at: string;
          event_date: string;
          event_id: string;
          event_title: string;
          geofence_radius_m: number;
          headcount: number;
          home_lat: number;
          home_lng: number;
          hours_limit: boolean;
          pay_rate: number;
          qualified: boolean;
          role: string;
          shift_id: string;
          starts_at: string;
          venue_address: string;
          venue_lat: number;
          venue_lng: number;
          venue_name: string;
          week_start: string;
        }[];
      };
      staff_save_bank: {
        Args: {
          p_account_holder: string;
          p_account_number: string;
          p_sort_code: string;
        };
        Returns: Json;
      };
      staff_set_ni_number: { Args: { p_ni: string }; Returns: Json };
      staff_set_photo: { Args: { p_path: string }; Returns: Json };
      staff_shift_detail: {
        Args: { p_booking: string };
        Returns: {
          booking_id: string;
          breaks: Json;
          cancel_cause: string;
          check_in_at: string;
          check_out_at: string;
          confirmed_at: string;
          dress_code: string;
          ends_at: string;
          event_cancelled_at: string;
          event_date: string;
          event_title: string;
          geofence_radius_m: number;
          left_early: boolean;
          no_checkout_open: boolean;
          notes: string;
          onsite_contact: string;
          pay_rate: number;
          pays_breaks: boolean;
          role: string;
          starts_at: string;
          status: string;
          turned_away_at: string;
          turned_away_pay_min: number;
          venue_address: string;
          venue_lat: number;
          venue_lng: number;
          venue_name: string;
        }[];
      };
      staff_show_rate: { Args: { p_staff: string }; Returns: number };
      staff_sync_email: { Args: never; Returns: Json };
      staff_transition_allowed: {
        Args: {
          p_from: Database['public']['Enums']['staff_status'];
          p_to: Database['public']['Enums']['staff_status'];
        };
        Returns: boolean;
      };
      staff_update_contact: {
        Args: { p_home_address: string; p_phone: string };
        Returns: Json;
      };
      staff_update_contact_for: {
        Args: { p_home_address: string; p_phone: string; p_staff: string };
        Returns: Json;
      };
      staff_update_contact_geocoded: {
        Args: {
          p_home_address: string;
          p_lat: number;
          p_lng: number;
          p_phone: string;
          p_staff: string;
        };
        Returns: Json;
      };
      staff_week_meter: { Args: { p_staff?: string }; Returns: Json };
      staff_writer: { Args: { p_staff?: string }; Returns: string };
      start_break: { Args: { p_booking: string }; Returns: Json };
      submit_application: {
        Args: {
          p_consent: boolean;
          p_dob: string;
          p_email: string;
          p_first_name: string;
          p_last_name: string;
          p_phone: string;
        };
        Returns: undefined;
      };
      submit_application_as_caller: {
        Args: {
          p_caller_hash: string;
          p_consent: boolean;
          p_dob: string;
          p_email: string;
          p_first_name: string;
          p_last_name: string;
          p_phone: string;
        };
        Returns: undefined;
      };
      submit_client_feedback: {
        Args: { p_booking_id: string; p_rating: number; p_text?: string };
        Returns: string;
      };
      submit_completion_letter: {
        Args: {
          p_awarding_institution?: string;
          p_completion_date: string;
          p_evidence_form: string;
          p_file_path: string;
          p_staff?: string;
        };
        Returns: Json;
      };
      submit_document_upload: {
        Args: {
          p_doc_type: string;
          p_file_path?: string;
          p_share_code?: string;
          p_staff?: string;
        };
        Returns: Json;
      };
      submit_hmrc_checklist:
        | {
            Args: {
              p_declared: boolean;
              p_ni_number: string;
              p_postgraduate: boolean;
              p_q1_other_job: boolean;
              p_q2_pension: boolean;
              p_q3_since_april: boolean;
              p_student_loan: string;
            };
            Returns: Json;
          }
        | {
            Args: {
              p_declared: boolean;
              p_gender: string;
              p_ni_number: string;
              p_postgraduate: boolean;
              p_q1_other_job: boolean;
              p_q2_pension: boolean;
              p_q3_since_april: boolean;
              p_student_loan: string;
            };
            Returns: Json;
          };
      submit_quiz_attempt: { Args: { p_answers: Json }; Returns: Json };
      term_letter_applies: {
        Args: { p_on?: string; p_staff: string };
        Returns: boolean;
      };
      term_letter_expired: {
        Args: { p_ranges: unknown[]; p_today: string };
        Returns: boolean;
      };
      turned_away_minutes: {
        Args: { p_attempt_at: string; p_starts_at: string };
        Returns: number;
      };
      uk_local: { Args: { p_now?: string }; Returns: string };
      unblock_if_compliant: {
        Args: { p_on?: string; p_staff: string };
        Returns: boolean;
      };
      unblock_worker: {
        Args: { p_actor?: string; p_on?: string; p_staff: string };
        Returns: Json;
      };
      unlockrows: { Args: { '': string }; Returns: number };
      unpaid_break_minutes: { Args: { p_booking: string }; Returns: number };
      update_client: {
        Args: {
          p_contact_emails: string[];
          p_contact_name: string;
          p_id: string;
          p_name: string;
          p_pays_breaks: boolean;
          p_pays_buffer: boolean;
          p_phone: string;
          p_staff_contact_point: string;
        };
        Returns: undefined;
      };
      update_client_role: {
        Args: { p_charge_rate: number; p_dress_codes: string[]; p_id: string };
        Returns: Json;
      };
      update_office_feedback: {
        Args: {
          p_event?: string;
          p_id: string;
          p_rating: number;
          p_text: string;
        };
        Returns: Json;
      };
      update_role: {
        Args: {
          p_description: string;
          p_id: string;
          p_name: string;
          p_pay_rate: number;
        };
        Returns: undefined;
      };
      update_venue: {
        Args: {
          p_address: string;
          p_geofence_radius_m: number;
          p_id: string;
          p_lat: number;
          p_lng: number;
          p_name: string;
          p_venue_type: string;
        };
        Returns: undefined;
      };
      updategeometrysrid: {
        Args: {
          catalogn_name: string;
          column_name: string;
          new_srid_in: number;
          schema_name: string;
          table_name: string;
        };
        Returns: string;
      };
      venue_point: { Args: { p_lat: number; p_lng: number }; Returns: unknown };
      verify_declaration: {
        Args: { p_declaration: string; p_note?: string };
        Returns: Json;
      };
      verify_document: {
        Args: {
          p_completion_date?: string;
          p_doc: string;
          p_expiry?: string;
          p_term_dates?: unknown[];
        };
        Returns: Json;
      };
      weekly_booked_hours: {
        Args: { p_date: string; p_staff: string };
        Returns: number;
      };
      weekly_booked_hours_except: {
        Args: { p_date: string; p_shift: string; p_staff: string };
        Returns: number;
      };
      weekly_cap:
        | {
            Args: {
              p_completion_letter_verified: boolean;
              p_optout_48h: boolean;
              p_term_state: string;
              p_visa_limited: boolean;
            };
            Returns: Database['public']['CompositeTypes']['cap_assessment'];
            SetofOptions: {
              from: '*';
              to: 'cap_assessment';
              isOneToOne: true;
              isSetofReturn: false;
            };
          }
        | {
            Args: {
              p_below_degree_level: boolean;
              p_completion_date: string;
              p_completion_letter_verified: boolean;
              p_optout_48h: boolean;
              p_optout_cancelled_from: string;
              p_term_state: string;
              p_under18: boolean;
              p_visa_expiry: string;
              p_visa_limited: boolean;
              p_week_start: string;
            };
            Returns: Database['public']['CompositeTypes']['cap_assessment'];
            SetofOptions: {
              from: '*';
              to: 'cap_assessment';
              isOneToOne: true;
              isSetofReturn: false;
            };
          }
        | {
            Args: {
              p_below_degree_level: boolean;
              p_completion_date: string;
              p_completion_letter_verified: boolean;
              p_optout_48h: boolean;
              p_optout_cancelled_from: string;
              p_term_state: string;
              p_under18: boolean;
              p_verified_on: string;
              p_visa_expiry: string;
              p_visa_hour_limit: number;
              p_visa_limited: boolean;
              p_week_start: string;
            };
            Returns: Database['public']['CompositeTypes']['cap_assessment'];
            SetofOptions: {
              from: '*';
              to: 'cap_assessment';
              isOneToOne: true;
              isSetofReturn: false;
            };
          };
      weekly_cap_band: {
        Args: { p_date: string; p_staff: string };
        Returns: Database['public']['Enums']['cap_band'];
      };
      weekly_cap_for: {
        Args: { p_date: string; p_staff: string };
        Returns: Database['public']['CompositeTypes']['cap_assessment'];
        SetofOptions: {
          from: '*';
          to: 'cap_assessment';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      weekly_cap_hours: {
        Args: { p_date: string; p_staff: string };
        Returns: number;
      };
      weekly_cap_would_breach: {
        Args: { p_shift: string; p_staff: string };
        Returns: boolean;
      };
      weekly_hours_remaining: {
        Args: { p_date: string; p_staff: string };
        Returns: number;
      };
      willo_accept_with_account: {
        Args: {
          p_at: string;
          p_details: Json;
          p_event: string;
          p_user: string;
          p_willo_candidate_id: string;
        };
        Returns: Json;
      };
      willo_event_plan: {
        Args: { p_event: string; p_willo_candidate_id: string };
        Returns: Json;
      };
      willo_invite_created: {
        Args: { p_at?: string; p_staff: string; p_willo_candidate_id: string };
        Returns: Json;
      };
      willo_invite_due: {
        Args: { p_limit?: number; p_now?: string };
        Returns: {
          attempt: number;
          email: string;
          first_name: string;
          known_candidate_id: string;
          last_name: string;
          phone: string;
          prior_candidate_ids: string[];
          staff_id: string;
        }[];
      };
      willo_invite_failed: {
        Args: { p_error: string; p_staff: string };
        Returns: undefined;
      };
      willo_link_candidate: {
        Args: {
          p_invited_at?: string;
          p_staff: string;
          p_willo_candidate_id: string;
        };
        Returns: undefined;
      };
      willo_record_event: {
        Args: {
          p_at?: string;
          p_details?: Json;
          p_event: string;
          p_willo_candidate_id: string;
        };
        Returns: Json;
      };
      willo_record_failure: {
        Args: { p_code: string; p_event: string; p_willo_candidate_id: string };
        Returns: undefined;
      };
      willo_record_refusal: {
        Args: { p_code: string; p_event: string; p_willo_candidate_id: string };
        Returns: undefined;
      };
      withdraw_application: { Args: { p_booking: string }; Returns: Json };
      withdraw_booking: { Args: { p_booking: string }; Returns: Json };
      wtr_optout_do_cancel: { Args: { p_staff: string }; Returns: Json };
      wtr_optout_do_sign: {
        Args: {
          p_notice_days: number;
          p_signed_copy_path: string;
          p_staff: string;
        };
        Returns: Json;
      };
      wtr_optout_subject: { Args: { p_staff: string }; Returns: string };
    };
    Enums: {
      app_role: 'admin' | 'client' | 'staff';
      application_outcome: 'candidate_created' | 'returning_applicant';
      block_kind: 'auto_document' | 'manual' | 'conviction_review';
      booking_source: 'auto' | 'manual' | 'self' | 'escalation';
      booking_status:
        'invited' | 'confirmed' | 'worked' | 'cancelled' | 'closed' | 'applied' | 'turned_away';
      cap_band:
        | 'student_term_20'
        | 'student_holiday_48'
        | 'graduated_48'
        | 'standard_48'
        | 'uncapped'
        | 'visa_expired_0'
        | 'student_term_10'
        | 'visa_limit';
      checklog_outcome: 'checked_in' | 'turned_away' | 'out_of_radius';
      declaration_source: 'onboarding' | 'in_employment';
      doc_type:
        | 'passport'
        | 'birth_certificate'
        | 'ni_evidence'
        | 'national_id'
        | 'visa_document'
        | 'status_document'
        | 'university_term_dates_letter'
        | 'university_completion_letter'
        | 'share_code_report';
      event_status: 'upcoming' | 'ongoing' | 'completed' | 'cancelled';
      feedback_author: 'client' | 'office';
      hmrc_statement: 'A' | 'B' | 'C';
      notification_channel: 'push' | 'email' | 'sms';
      office_role: 'owner' | 'manager' | 'scheduler';
      review_status: 'pending' | 'verified' | 'rejected' | 'superseded';
      rtw_branch:
        'uk_irish' | 'eu_settled' | 'work_visa' | 'international_student' | 'dependant_other';
      staff_status:
        | 'interview_requested'
        | 'interview_completed'
        | 'documents'
        | 'quiz'
        | 'additional_info'
        | 'contract'
        | 'compliant'
        | 'blocked'
        | 'inactive'
        | 'rejected'
        | 'removed';
      student_loan_plan: 'none' | 'plan1' | 'plan2' | 'plan4';
      violation_type: 'no_show' | 'late' | 'left_early' | 'left_geofence' | 'no_checkout';
    };
    CompositeTypes: {
      cap_assessment: {
        cap_hours: number | null;
        band: Database['public']['Enums']['cap_band'] | null;
      };
      geometry_dump: {
        path: number[] | null;
        geom: unknown;
      };
      valid_detail: {
        valid: boolean | null;
        reason: string | null;
        location: unknown;
      };
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ['admin', 'client', 'staff'],
      application_outcome: ['candidate_created', 'returning_applicant'],
      block_kind: ['auto_document', 'manual', 'conviction_review'],
      booking_source: ['auto', 'manual', 'self', 'escalation'],
      booking_status: [
        'invited',
        'confirmed',
        'worked',
        'cancelled',
        'closed',
        'applied',
        'turned_away',
      ],
      cap_band: [
        'student_term_20',
        'student_holiday_48',
        'graduated_48',
        'standard_48',
        'uncapped',
        'visa_expired_0',
        'student_term_10',
        'visa_limit',
      ],
      checklog_outcome: ['checked_in', 'turned_away', 'out_of_radius'],
      declaration_source: ['onboarding', 'in_employment'],
      doc_type: [
        'passport',
        'birth_certificate',
        'ni_evidence',
        'national_id',
        'visa_document',
        'status_document',
        'university_term_dates_letter',
        'university_completion_letter',
        'share_code_report',
      ],
      event_status: ['upcoming', 'ongoing', 'completed', 'cancelled'],
      feedback_author: ['client', 'office'],
      hmrc_statement: ['A', 'B', 'C'],
      notification_channel: ['push', 'email', 'sms'],
      office_role: ['owner', 'manager', 'scheduler'],
      review_status: ['pending', 'verified', 'rejected', 'superseded'],
      rtw_branch: [
        'uk_irish',
        'eu_settled',
        'work_visa',
        'international_student',
        'dependant_other',
      ],
      staff_status: [
        'interview_requested',
        'interview_completed',
        'documents',
        'quiz',
        'additional_info',
        'contract',
        'compliant',
        'blocked',
        'inactive',
        'rejected',
        'removed',
      ],
      student_loan_plan: ['none', 'plan1', 'plan2', 'plan4'],
      violation_type: ['no_show', 'late', 'left_early', 'left_geofence', 'no_checkout'],
    },
  },
} as const;
