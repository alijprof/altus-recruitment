// @ts-nocheck
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      activities: {
        Row: {
          actor_user_id: string | null
          body: string | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          kind: Database["public"]["Enums"]["activity_kind"]
          metadata: Json
          occurred_at: string
          organization_id: string
        }
        Insert: {
          actor_user_id?: string | null
          body?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          kind: Database["public"]["Enums"]["activity_kind"]
          metadata?: Json
          occurred_at?: string
          organization_id: string
        }
        Update: {
          actor_user_id?: string | null
          body?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          kind?: Database["public"]["Enums"]["activity_kind"]
          metadata?: Json
          occurred_at?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activities_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_cap_notifications: {
        Row: {
          bucket: string
          created_at: string
          id: string
          notified_month: string
          organization_id: string
        }
        Insert: {
          bucket: string
          created_at?: string
          id?: string
          notified_month: string
          organization_id: string
        }
        Update: {
          bucket?: string
          created_at?: string
          id?: string
          notified_month?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_cap_notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_summaries: {
        Row: {
          candidate_embedding_version: number | null
          candidate_id: string | null
          content: Json
          cost_pence: number
          created_at: string
          expires_at: string | null
          id: string
          job_embedding_version: number | null
          job_id: string | null
          kind: string
          model: string
          organization_id: string
        }
        Insert: {
          candidate_embedding_version?: number | null
          candidate_id?: string | null
          content: Json
          cost_pence: number
          created_at?: string
          expires_at?: string | null
          id?: string
          job_embedding_version?: number | null
          job_id?: string | null
          kind: string
          model: string
          organization_id: string
        }
        Update: {
          candidate_embedding_version?: number | null
          candidate_id?: string | null
          content?: Json
          cost_pence?: number
          created_at?: string
          expires_at?: string | null
          id?: string
          job_embedding_version?: number | null
          job_id?: string | null
          kind?: string
          model?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_summaries_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_summaries_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_summaries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_usage: {
        Row: {
          cost_pence: number
          created_at: string
          id: string
          input_tokens: number
          latency_ms: number | null
          model: string
          organization_id: string
          output_tokens: number
          purpose: string
          user_id: string | null
        }
        Insert: {
          cost_pence: number
          created_at?: string
          id?: string
          input_tokens: number
          latency_ms?: number | null
          model: string
          organization_id: string
          output_tokens: number
          purpose: string
          user_id?: string | null
        }
        Update: {
          cost_pence?: number
          created_at?: string
          id?: string
          input_tokens?: number
          latency_ms?: number | null
          model?: string
          organization_id?: string
          output_tokens?: number
          purpose?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      applications: {
        Row: {
          application_type: Database["public"]["Enums"]["application_type"]
          candidate_id: string
          created_at: string
          created_by: string | null
          decline_notes: string | null
          decline_reason: Database["public"]["Enums"]["decline_reason"] | null
          declined_at: string | null
          fee_pence: number | null
          id: string
          job_id: string | null
          organization_id: string
          owner_user_id: string | null
          placed_at: string | null
          placement_currency: string
          placement_type: Database["public"]["Enums"]["placement_type"] | null
          stage: Database["public"]["Enums"]["application_stage"]
          stage_changed_at: string
          updated_at: string
        }
        Insert: {
          application_type?: Database["public"]["Enums"]["application_type"]
          candidate_id: string
          created_at?: string
          created_by?: string | null
          decline_notes?: string | null
          decline_reason?: Database["public"]["Enums"]["decline_reason"] | null
          declined_at?: string | null
          fee_pence?: number | null
          id?: string
          job_id?: string | null
          organization_id: string
          owner_user_id?: string | null
          placed_at?: string | null
          placement_currency?: string
          placement_type?: Database["public"]["Enums"]["placement_type"] | null
          stage?: Database["public"]["Enums"]["application_stage"]
          stage_changed_at?: string
          updated_at?: string
        }
        Update: {
          application_type?: Database["public"]["Enums"]["application_type"]
          candidate_id?: string
          created_at?: string
          created_by?: string | null
          decline_notes?: string | null
          decline_reason?: Database["public"]["Enums"]["decline_reason"] | null
          declined_at?: string | null
          fee_pence?: number | null
          id?: string
          job_id?: string | null
          organization_id?: string
          owner_user_id?: string | null
          placed_at?: string | null
          placement_currency?: string
          placement_type?: Database["public"]["Enums"]["placement_type"] | null
          stage?: Database["public"]["Enums"]["application_stage"]
          stage_changed_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "applications_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      apply_form_rate_limits: {
        Row: {
          count: number
          ip_hash: string
          organization_id: string
          window_start: string
        }
        Insert: {
          count?: number
          ip_hash: string
          organization_id: string
          window_start?: string
        }
        Update: {
          count?: number
          ip_hash?: string
          organization_id?: string
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "apply_form_rate_limits_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: Database["public"]["Enums"]["audit_action"]
          actor_user_id: string | null
          at: string
          entity_id: string
          entity_type: string
          id: string
          metadata: Json
          organization_id: string
        }
        Insert: {
          action: Database["public"]["Enums"]["audit_action"]
          actor_user_id?: string | null
          at?: string
          entity_id: string
          entity_type: string
          id?: string
          metadata?: Json
          organization_id: string
        }
        Update: {
          action?: Database["public"]["Enums"]["audit_action"]
          actor_user_id?: string | null
          at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          metadata?: Json
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_cvs: {
        Row: {
          candidate_id: string
          created_at: string
          extracted_data: Json | null
          file_size_bytes: number | null
          id: string
          mime_type: string
          organization_id: string
          parse_error: string | null
          parsing_status: Database["public"]["Enums"]["cv_parsing_status"]
          storage_path: string
          updated_at: string
          uploaded_by: string | null
          version: number
        }
        Insert: {
          candidate_id: string
          created_at?: string
          extracted_data?: Json | null
          file_size_bytes?: number | null
          id?: string
          mime_type: string
          organization_id: string
          parse_error?: string | null
          parsing_status?: Database["public"]["Enums"]["cv_parsing_status"]
          storage_path: string
          updated_at?: string
          uploaded_by?: string | null
          version: number
        }
        Update: {
          candidate_id?: string
          created_at?: string
          extracted_data?: Json | null
          file_size_bytes?: number | null
          id?: string
          mime_type?: string
          organization_id?: string
          parse_error?: string | null
          parsing_status?: Database["public"]["Enums"]["cv_parsing_status"]
          storage_path?: string
          updated_at?: string
          uploaded_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "candidate_cvs_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_cvs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_cvs_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      candidates: {
        Row: {
          about: string | null
          candidate_embedding: unknown
          consent_at: string | null
          consent_basis: Database["public"]["Enums"]["consent_basis"] | null
          consent_text_version: string | null
          created_at: string
          created_by: string | null
          currency: string
          current_company: string | null
          current_role_title: string | null
          education: Json
          email: string | null
          email_marketing_unsubscribed_at: string | null
          embedded_at: string | null
          embedding_version: number | null
          full_name: string
          headline: string | null
          id: string
          last_contacted_at: string | null
          location: string | null
          market_status: Database["public"]["Enums"]["market_status"]
          market_status_at: string
          organization_id: string
          phone: string | null
          referrer_candidate_id: string | null
          salary_current_estimate: number | null
          salary_expectation: number | null
          sector_tags: string[]
          seniority_level: string | null
          skills: string[]
          source: Database["public"]["Enums"]["candidate_source"]
          source_detail: string | null
          updated_at: string
          work_experience: Json
          years_experience: number | null
        }
        Insert: {
          about?: string | null
          candidate_embedding?: unknown
          consent_at?: string | null
          consent_basis?: Database["public"]["Enums"]["consent_basis"] | null
          consent_text_version?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          current_company?: string | null
          current_role_title?: string | null
          education?: Json
          email?: string | null
          email_marketing_unsubscribed_at?: string | null
          embedded_at?: string | null
          embedding_version?: number | null
          full_name: string
          headline?: string | null
          id?: string
          last_contacted_at?: string | null
          location?: string | null
          market_status?: Database["public"]["Enums"]["market_status"]
          market_status_at?: string
          organization_id: string
          phone?: string | null
          referrer_candidate_id?: string | null
          salary_current_estimate?: number | null
          salary_expectation?: number | null
          sector_tags?: string[]
          seniority_level?: string | null
          skills?: string[]
          source?: Database["public"]["Enums"]["candidate_source"]
          source_detail?: string | null
          updated_at?: string
          work_experience?: Json
          years_experience?: number | null
        }
        Update: {
          about?: string | null
          candidate_embedding?: unknown
          consent_at?: string | null
          consent_basis?: Database["public"]["Enums"]["consent_basis"] | null
          consent_text_version?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          current_company?: string | null
          current_role_title?: string | null
          education?: Json
          email?: string | null
          email_marketing_unsubscribed_at?: string | null
          embedded_at?: string | null
          embedding_version?: number | null
          full_name?: string
          headline?: string | null
          id?: string
          last_contacted_at?: string | null
          location?: string | null
          market_status?: Database["public"]["Enums"]["market_status"]
          market_status_at?: string
          organization_id?: string
          phone?: string | null
          referrer_candidate_id?: string | null
          salary_current_estimate?: number | null
          salary_expectation?: number | null
          sector_tags?: string[]
          seniority_level?: string | null
          skills?: string[]
          source?: Database["public"]["Enums"]["candidate_source"]
          source_detail?: string | null
          updated_at?: string
          work_experience?: Json
          years_experience?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "candidates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidates_referrer_candidate_id_fkey"
            columns: ["referrer_candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          industry: string | null
          last_contacted_at: string | null
          name: string
          notes: string | null
          organization_id: string
          updated_at: string
          website: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          industry?: string | null
          last_contacted_at?: string | null
          name: string
          notes?: string | null
          organization_id: string
          updated_at?: string
          website?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          industry?: string | null
          last_contacted_at?: string | null
          name?: string
          notes?: string | null
          organization_id?: string
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "companies_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "companies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          email: string | null
          full_name: string
          id: string
          last_contacted_at: string | null
          notes: string | null
          organization_id: string
          phone: string | null
          role_title: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          email?: string | null
          full_name: string
          id?: string
          last_contacted_at?: string | null
          notes?: string | null
          organization_id: string
          phone?: string | null
          role_title?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          email?: string | null
          full_name?: string
          id?: string
          last_contacted_at?: string | null
          notes?: string | null
          organization_id?: string
          phone?: string | null
          role_title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "client_activity_timeline"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_campaign_recipients: {
        Row: {
          campaign_id: string
          candidate_id: string
          created_at: string
          email: string
          error_message: string | null
          id: string
          organization_id: string
          personalised_intro: string | null
          personalised_outro: string | null
          resend_email_id: string | null
          sent_at: string | null
          status: string
          unsubscribe_token: string | null
        }
        Insert: {
          campaign_id: string
          candidate_id: string
          created_at?: string
          email: string
          error_message?: string | null
          id?: string
          organization_id: string
          personalised_intro?: string | null
          personalised_outro?: string | null
          resend_email_id?: string | null
          sent_at?: string | null
          status?: string
          unsubscribe_token?: string | null
        }
        Update: {
          campaign_id?: string
          candidate_id?: string
          created_at?: string
          email?: string
          error_message?: string | null
          id?: string
          organization_id?: string
          personalised_intro?: string | null
          personalised_outro?: string | null
          resend_email_id?: string | null
          sent_at?: string | null
          status?: string
          unsubscribe_token?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_campaign_recipients_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "email_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_campaign_recipients_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_campaign_recipients_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_campaigns: {
        Row: {
          approved_at: string | null
          body_template: string
          created_at: string
          created_by: string
          failed_count: number
          id: string
          name: string
          organization_id: string
          recipient_count: number | null
          segment_market_statuses: string[]
          sent_at: string | null
          sent_count: number
          status: string
          subject_template: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          body_template: string
          created_at?: string
          created_by: string
          failed_count?: number
          id?: string
          name: string
          organization_id: string
          recipient_count?: number | null
          segment_market_statuses: string[]
          sent_at?: string | null
          sent_count?: number
          status?: string
          subject_template: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          body_template?: string
          created_at?: string
          created_by?: string
          failed_count?: number
          id?: string
          name?: string
          organization_id?: string
          recipient_count?: number | null
          segment_market_statuses?: string[]
          sent_at?: string | null
          sent_count?: number
          status?: string
          subject_template?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_campaigns_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback: {
        Row: {
          body: string
          created_at: string
          id: string
          organization_id: string
          page_url: string | null
          submitted_by: string
          user_agent: string | null
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          organization_id: string
          page_url?: string | null
          submitted_by: string
          user_agent?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          organization_id?: string
          page_url?: string | null
          submitted_by?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feedback_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      hnsw_build_state: {
        Row: {
          built_at: string | null
          last_attempt_at: string | null
          last_error: string | null
          table_name: string
        }
        Insert: {
          built_at?: string | null
          last_attempt_at?: string | null
          last_error?: string | null
          table_name: string
        }
        Update: {
          built_at?: string | null
          last_attempt_at?: string | null
          last_error?: string | null
          table_name?: string
        }
        Relationships: []
      }
      job_ads: {
        Row: {
          body_markdown: string
          cost_pence: number
          created_at: string
          created_by: string | null
          id: string
          inclusivity_dimensions: Json | null
          inclusivity_score: number | null
          inclusivity_suggestions: Json | null
          job_id: string
          model: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          body_markdown: string
          cost_pence: number
          created_at?: string
          created_by?: string | null
          id?: string
          inclusivity_dimensions?: Json | null
          inclusivity_score?: number | null
          inclusivity_suggestions?: Json | null
          job_id: string
          model: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          body_markdown?: string
          cost_pence?: number
          created_at?: string
          created_by?: string | null
          id?: string
          inclusivity_dimensions?: Json | null
          inclusivity_score?: number | null
          inclusivity_suggestions?: Json | null
          job_id?: string
          model?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_ads_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_ads_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_ads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          currency: string
          day_rate_max: number | null
          day_rate_min: number | null
          description: string | null
          embedded_at: string | null
          embedding_version: number | null
          fee_percent: number | null
          hiring_context: Database["public"]["Enums"]["hiring_context"]
          id: string
          job_embedding: unknown
          job_type: Database["public"]["Enums"]["job_type"]
          location: string | null
          organization_id: string
          owner_user_id: string | null
          salary_max: number | null
          salary_min: number | null
          sector: string | null
          status: Database["public"]["Enums"]["job_status"]
          title: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          currency?: string
          day_rate_max?: number | null
          day_rate_min?: number | null
          description?: string | null
          embedded_at?: string | null
          embedding_version?: number | null
          fee_percent?: number | null
          hiring_context?: Database["public"]["Enums"]["hiring_context"]
          id?: string
          job_embedding?: unknown
          job_type?: Database["public"]["Enums"]["job_type"]
          location?: string | null
          organization_id: string
          owner_user_id?: string | null
          salary_max?: number | null
          salary_min?: number | null
          sector?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          title: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          day_rate_max?: number | null
          day_rate_min?: number | null
          description?: string | null
          embedded_at?: string | null
          embedding_version?: number | null
          fee_percent?: number | null
          hiring_context?: Database["public"]["Enums"]["hiring_context"]
          id?: string
          job_embedding?: unknown
          job_type?: Database["public"]["Enums"]["job_type"]
          location?: string | null
          organization_id?: string
          owner_user_id?: string | null
          salary_max?: number | null
          salary_min?: number | null
          sector?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "client_activity_timeline"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "jobs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      org_invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          organization_id: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          organization_id: string
          token?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          organization_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          apply_form_enabled: boolean
          brand_primary: string | null
          brand_secondary: string | null
          created_at: string
          id: string
          logo_url: string | null
          name: string
          slug: string
          stripe_customer_id: string | null
          updated_at: string
        }
        Insert: {
          apply_form_enabled?: boolean
          brand_primary?: string | null
          brand_secondary?: string | null
          created_at?: string
          id?: string
          logo_url?: string | null
          name: string
          slug: string
          stripe_customer_id?: string | null
          updated_at?: string
        }
        Update: {
          apply_form_enabled?: boolean
          brand_primary?: string | null
          brand_secondary?: string | null
          created_at?: string
          id?: string
          logo_url?: string | null
          name?: string
          slug?: string
          stripe_customer_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      outlook_credentials: {
        Row: {
          access_token_encrypted: string | null
          access_token_expires_at: string | null
          created_at: string
          delta_link: string | null
          encryption_key_version: number
          id: string
          last_renewal_attempt_at: string | null
          last_renewal_error: string | null
          last_synced_at: string | null
          microsoft_email: string
          microsoft_tenant_id: string
          microsoft_user_id: string
          organization_id: string
          refresh_token_encrypted: string | null
          revoked_at: string | null
          scopes: string[]
          subscription_client_state: string | null
          subscription_expires_at: string | null
          subscription_id: string | null
          subscription_resource: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token_encrypted?: string | null
          access_token_expires_at?: string | null
          created_at?: string
          delta_link?: string | null
          encryption_key_version?: number
          id?: string
          last_renewal_attempt_at?: string | null
          last_renewal_error?: string | null
          last_synced_at?: string | null
          microsoft_email: string
          microsoft_tenant_id: string
          microsoft_user_id: string
          organization_id: string
          refresh_token_encrypted?: string | null
          revoked_at?: string | null
          scopes?: string[]
          subscription_client_state?: string | null
          subscription_expires_at?: string | null
          subscription_id?: string | null
          subscription_resource?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token_encrypted?: string | null
          access_token_expires_at?: string | null
          created_at?: string
          delta_link?: string | null
          encryption_key_version?: number
          id?: string
          last_renewal_attempt_at?: string | null
          last_renewal_error?: string | null
          last_synced_at?: string | null
          microsoft_email?: string
          microsoft_tenant_id?: string
          microsoft_user_id?: string
          organization_id?: string
          refresh_token_encrypted?: string | null
          revoked_at?: string | null
          scopes?: string[]
          subscription_client_state?: string | null
          subscription_expires_at?: string | null
          subscription_id?: string | null
          subscription_resource?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "outlook_credentials_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outlook_credentials_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_overrides: {
        Row: {
          cap_multiplier: number | null
          note: string | null
          organization_id: string
          trial_end_override: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          cap_multiplier?: number | null
          note?: string | null
          organization_id: string
          trial_end_override?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          cap_multiplier?: number | null
          note?: string | null
          organization_id?: string
          trial_end_override?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plan_overrides_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      spec_drafts: {
        Row: {
          approved_at: string | null
          audio_duration_seconds: number | null
          audio_mime_type: string | null
          audio_storage_path: string | null
          company_id: string | null
          created_at: string
          created_by: string
          created_job_id: string | null
          deleted_at: string | null
          id: string
          organization_id: string
          parse_error: string | null
          rejected_at: string | null
          sonnet_cost_pence: number | null
          status: Database["public"]["Enums"]["spec_draft_status"]
          status_changed_at: string
          structured_data: Json
          transcript: string | null
          updated_at: string
          whisper_cost_pence: number | null
        }
        Insert: {
          approved_at?: string | null
          audio_duration_seconds?: number | null
          audio_mime_type?: string | null
          audio_storage_path?: string | null
          company_id?: string | null
          created_at?: string
          created_by: string
          created_job_id?: string | null
          deleted_at?: string | null
          id?: string
          organization_id: string
          parse_error?: string | null
          rejected_at?: string | null
          sonnet_cost_pence?: number | null
          status?: Database["public"]["Enums"]["spec_draft_status"]
          status_changed_at?: string
          structured_data?: Json
          transcript?: string | null
          updated_at?: string
          whisper_cost_pence?: number | null
        }
        Update: {
          approved_at?: string | null
          audio_duration_seconds?: number | null
          audio_mime_type?: string | null
          audio_storage_path?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string
          created_job_id?: string | null
          deleted_at?: string | null
          id?: string
          organization_id?: string
          parse_error?: string | null
          rejected_at?: string | null
          sonnet_cost_pence?: number | null
          status?: Database["public"]["Enums"]["spec_draft_status"]
          status_changed_at?: string
          structured_data?: Json
          transcript?: string | null
          updated_at?: string
          whisper_cost_pence?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "spec_drafts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "client_activity_timeline"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "spec_drafts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spec_drafts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spec_drafts_created_job_id_fkey"
            columns: ["created_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spec_drafts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_webhook_events: {
        Row: {
          created_at: string
          event_type: string | null
          stripe_event_id: string
        }
        Insert: {
          created_at?: string
          event_type?: string | null
          stripe_event_id: string
        }
        Update: {
          created_at?: string
          event_type?: string | null
          stripe_event_id?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          created_at: string
          current_period_end: string | null
          id: string
          organization_id: string
          plan_key: string
          plan_seats: number
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          trial_end: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          id?: string
          organization_id: string
          plan_key?: string
          plan_seats?: number
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trial_end?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          id?: string
          organization_id?: string
          plan_key?: string
          plan_seats?: number
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trial_end?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string
          email: string
          full_name: string | null
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          organization_id: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "users_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_notes: {
        Row: {
          applied_at: string | null
          audio_duration_seconds: number | null
          audio_mime_type: string | null
          audio_storage_path: string | null
          candidate_id: string
          created_at: string
          created_by: string
          deleted_at: string | null
          id: string
          organization_id: string
          parse_error: string | null
          status: string
          structured_data: Json | null
          transcript: string | null
          updated_at: string
        }
        Insert: {
          applied_at?: string | null
          audio_duration_seconds?: number | null
          audio_mime_type?: string | null
          audio_storage_path?: string | null
          candidate_id: string
          created_at?: string
          created_by: string
          deleted_at?: string | null
          id?: string
          organization_id: string
          parse_error?: string | null
          status?: string
          structured_data?: Json | null
          transcript?: string | null
          updated_at?: string
        }
        Update: {
          applied_at?: string | null
          audio_duration_seconds?: number | null
          audio_mime_type?: string | null
          audio_storage_path?: string | null
          candidate_id?: string
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          id?: string
          organization_id?: string
          parse_error?: string | null
          status?: string
          structured_data?: Json | null
          transcript?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "voice_notes_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_notes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      client_activity_timeline: {
        Row: {
          actor_email: string | null
          actor_full_name: string | null
          actor_user_id: string | null
          body: string | null
          client_id: string | null
          entity_id: string | null
          entity_label: string | null
          entity_type: string | null
          id: string | null
          kind: Database["public"]["Enums"]["activity_kind"] | null
          metadata: Json | null
          occurred_at: string | null
          organization_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activities_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_invitation: {
        Args: { p_token: string; p_user_email: string; p_user_id: string }
        Returns: {
          ok: boolean
          reason: string
        }[]
      }
      assert_same_org: {
        Args: {
          p_child_org_id: string
          p_parent_id: string
          p_parent_table: unknown
        }
        Returns: undefined
      }
      commission_summary_by_recruiter: {
        Args: { p_from?: string; p_to?: string }
        Returns: {
          estimated_commission_pence: number
          placements_count: number
          recruiter_id: string
          recruiter_name: string
          total_fee_pence: number
        }[]
      }
      current_organization_id: { Args: never; Returns: string }
      delete_candidate: { Args: { p_candidate_id: string }; Returns: undefined }
      delete_company: { Args: { p_company_id: string }; Returns: undefined }
      delete_job: { Args: { p_job_id: string }; Returns: undefined }
      dormant_clients: {
        Args: { p_dormant_days?: number; p_long_dormant_days?: number }
        Returns: {
          client_id: string
          client_name: string
          days_since: number
          is_long_dormant: boolean
          last_contacted_at: string
          last_placement_summary: string
        }[]
      }
      match_candidates: {
        Args: {
          p_match_count?: number
          p_min_cosine_similarity?: number
          p_organization_id: string
          p_query_embedding: unknown
          p_query_text: string
        }
        Returns: {
          cosine_similarity: number
          current_company: string
          current_role_title: string
          full_name: string
          id: string
          location: string
          market_status: Database["public"]["Enums"]["market_status"]
          rrf_score: number
          trigram_similarity: number
        }[]
      }
      match_candidates_for_job: {
        Args: {
          p_job_id: string
          p_match_count?: number
          p_organization_id: string
        }
        Returns: {
          cosine_similarity: number
          current_company: string
          current_role_title: string
          full_name: string
          id: string
          location: string
          market_status: Database["public"]["Enums"]["market_status"]
          rrf_score: number
          trigram_similarity: number
        }[]
      }
      match_jobs: {
        Args: {
          p_match_count?: number
          p_min_cosine_similarity?: number
          p_query_embedding: unknown
          p_query_text: string
        }
        Returns: {
          company_id: string
          cosine_similarity: number
          currency: string
          id: string
          job_type: Database["public"]["Enums"]["job_type"]
          location: string
          rrf_score: number
          salary_max: number
          salary_min: number
          status: Database["public"]["Enums"]["job_status"]
          title: string
          trigram_similarity: number
        }[]
      }
      move_application: {
        Args: {
          p_actor_user_id?: string
          p_application_id: string
          p_decline_notes?: string
          p_decline_reason?: Database["public"]["Enums"]["decline_reason"]
          p_placement_currency?: string
          p_placement_date?: string
          p_placement_fee_pence?: number
          p_placement_type?: Database["public"]["Enums"]["placement_type"]
          p_to_stage: Database["public"]["Enums"]["application_stage"]
        }
        Returns: undefined
      }
      nl_activity_volume_by_recruiter: {
        Args: { p_from?: string; p_to?: string }
        Returns: {
          activity_count: number
          recruiter_name: string
        }[]
      }
      nl_applications_per_job: {
        Args: { p_from?: string; p_to?: string }
        Returns: {
          applications_count: number
          company_name: string
          job_title: string
        }[]
      }
      nl_average_fee_by_sector: {
        Args: { p_from?: string; p_to?: string }
        Returns: {
          avg_fee_pence: number
          placements_count: number
          sector: string
        }[]
      }
      nl_biggest_fees: {
        Args: { p_from?: string; p_limit?: number; p_to?: string }
        Returns: {
          candidate_name: string
          company_name: string
          fee_pence: number
          job_title: string
          placed_date: string
        }[]
      }
      nl_candidates_added_per_month: {
        Args: { p_months?: number }
        Returns: {
          candidates_added: number
          month: string
        }[]
      }
      nl_candidates_by_market_status: {
        Args: never
        Returns: {
          candidate_count: number
          market_status: string
        }[]
      }
      nl_conversion_rate: {
        Args: { p_from?: string; p_to?: string }
        Returns: {
          conversion_pct: number
          cv_submissions: number
          placements: number
        }[]
      }
      nl_dormant_clients_count: {
        Args: { p_dormant_days?: number }
        Returns: {
          dormant_count: number
          threshold_days: number
        }[]
      }
      nl_fastest_fills: {
        Args: { p_from?: string; p_limit?: number; p_to?: string }
        Returns: {
          company_name: string
          days_to_fill: number
          job_title: string
          placed_date: string
        }[]
      }
      nl_fees_by_month: {
        Args: { p_months?: number }
        Returns: {
          month: string
          placements_count: number
          total_fee_pence: number
        }[]
      }
      nl_fees_by_recruiter: {
        Args: { p_from?: string; p_to?: string }
        Returns: {
          placements_count: number
          recruiter_name: string
          total_fee_pence: number
        }[]
      }
      nl_jobs_filled_vs_open: {
        Args: never
        Returns: {
          job_count: number
          status: string
        }[]
      }
      nl_jobs_opened_per_month: {
        Args: { p_months?: number }
        Returns: {
          jobs_opened: number
          month: string
        }[]
      }
      nl_pipeline_value_by_stage: {
        Args: never
        Returns: {
          candidate_count: number
          estimated_fee_pence: number
          stage: string
        }[]
      }
      nl_placements_by_recruiter: {
        Args: { p_from?: string; p_to?: string }
        Returns: {
          placements_count: number
          recruiter_name: string
          total_fee_pence: number
        }[]
      }
      nl_placements_by_sector: {
        Args: { p_from?: string; p_to?: string }
        Returns: {
          placements_count: number
          sector: string
          total_fee_pence: number
        }[]
      }
      nl_placements_this_quarter: {
        Args: never
        Returns: {
          placements_count: number
          quarter: string
          total_fee_pence: number
        }[]
      }
      nl_source_roi: {
        Args: { p_from?: string; p_to?: string }
        Returns: {
          placements_count: number
          source: string
          total_fee_pence: number
        }[]
      }
      nl_time_to_fill_by_recruiter: {
        Args: { p_from?: string; p_to?: string }
        Returns: {
          median_days: number
          placements_count: number
          recruiter_name: string
        }[]
      }
      nl_top_sources_by_placements: {
        Args: { p_from?: string; p_limit?: number; p_to?: string }
        Returns: {
          pct_of_total: number
          placements_count: number
          source: string
        }[]
      }
      pipeline_value_sparkline: {
        Args: { p_from?: string; p_to?: string }
        Returns: {
          bucket_date: string
          pipeline_value_pence: number
        }[]
      }
      placements_by_recruiter_quarter: {
        Args: { p_from?: string; p_to?: string }
        Returns: {
          placements_count: number
          quarter: string
          recruiter_id: string
          recruiter_name: string
        }[]
      }
      record_ai_usage: {
        Args: {
          p_cost_pence: number
          p_input_tokens: number
          p_latency_ms?: number
          p_model: string
          p_organization_id: string
          p_output_tokens: number
          p_purpose: string
          p_user_id?: string
        }
        Returns: string
      }
      record_audit: {
        Args: {
          p_action: Database["public"]["Enums"]["audit_action"]
          p_entity_id: string
          p_entity_type: string
          p_metadata?: Json
        }
        Returns: string
      }
      record_audit_anonymous: {
        Args: {
          p_action: Database["public"]["Enums"]["audit_action"]
          p_entity_id: string
          p_entity_type: string
          p_metadata?: Json
          p_organization_id: string
        }
        Returns: undefined
      }
      record_audit_explicit: {
        Args: {
          p_action: Database["public"]["Enums"]["audit_action"]
          p_actor_user_id: string
          p_entity_id: string
          p_entity_type: string
          p_metadata?: Json
          p_organization_id: string
        }
        Returns: undefined
      }
      search_candidates: {
        Args: { p_limit?: number; p_offset?: number; p_query: string }
        Returns: {
          created_at: string
          current_company: string
          current_role_title: string
          email: string
          full_name: string
          id: string
          last_contacted_at: string
          location: string
          market_status: Database["public"]["Enums"]["market_status"]
          organization_id: string
          phone: string
          similarity: number
          source: Database["public"]["Enums"]["candidate_source"]
          total_count: number
        }[]
      }
      search_clients: {
        Args: {
          p_dir?: string
          p_limit?: number
          p_offset?: number
          p_query: string
          p_sort?: string
          p_threshold?: number
        }
        Returns: {
          created_at: string
          created_by: string
          id: string
          industry: string
          last_contacted_at: string
          name: string
          notes: string
          organization_id: string
          similarity: number
          total_count: number
          updated_at: string
          website: string
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      source_attribution_summary: {
        Args: { p_from?: string; p_to?: string }
        Returns: {
          avg_time_to_place_days: number
          placements_count: number
          source: Database["public"]["Enums"]["candidate_source"]
          total_fee_pence: number
        }[]
      }
      time_to_fill_by_sector: {
        Args: { p_from?: string; p_to?: string }
        Returns: {
          median_days: number
          p90_days: number
          placements_count: number
          sector: string
        }[]
      }
    }
    Enums: {
      activity_kind:
        | "note"
        | "call"
        | "email"
        | "meeting"
        | "stage_change"
        | "system"
        | "email_draft"
      application_stage:
        | "applied"
        | "screening"
        | "cv_submitted"
        | "first_interview"
        | "second_interview"
        | "offer"
        | "placed"
        | "rejected"
        | "withdrawn"
      application_type: "standard" | "spec" | "float" | "shortlist"
      audit_action: "view" | "create" | "update" | "delete" | "export"
      candidate_source:
        | "apply_form"
        | "linkedin"
        | "referral"
        | "email_inbox"
        | "event"
        | "direct_add"
        | "other"
      consent_basis: "consent" | "legitimate_interest"
      cv_parsing_status: "pending" | "complete" | "failed"
      decline_reason:
        | "not_qualified"
        | "salary_mismatch"
        | "location_mismatch"
        | "candidate_withdrew"
        | "client_rejected_skills"
        | "client_rejected_culture"
        | "client_filled_internally"
        | "client_filled_other"
        | "other"
      hiring_context: "new_role" | "backfill"
      job_status: "draft" | "open" | "on_hold" | "filled" | "cancelled"
      job_type: "perm" | "contract" | "temp"
      market_status:
        | "actively_looking"
        | "passively_looking"
        | "hot"
        | "placed"
        | "cold"
      placement_type: "perm" | "contract" | "temp" | "fixed_term"
      spec_draft_status:
        | "pending"
        | "transcribing"
        | "ready_for_review"
        | "approved"
        | "rejected"
        | "failed"
      user_role: "owner" | "admin" | "recruiter"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      activity_kind: [
        "note",
        "call",
        "email",
        "meeting",
        "stage_change",
        "system",
        "email_draft",
      ],
      application_stage: [
        "applied",
        "screening",
        "cv_submitted",
        "first_interview",
        "second_interview",
        "offer",
        "placed",
        "rejected",
        "withdrawn",
      ],
      application_type: ["standard", "spec", "float", "shortlist"],
      audit_action: ["view", "create", "update", "delete", "export"],
      candidate_source: [
        "apply_form",
        "linkedin",
        "referral",
        "email_inbox",
        "event",
        "direct_add",
        "other",
      ],
      consent_basis: ["consent", "legitimate_interest"],
      cv_parsing_status: ["pending", "complete", "failed"],
      decline_reason: [
        "not_qualified",
        "salary_mismatch",
        "location_mismatch",
        "candidate_withdrew",
        "client_rejected_skills",
        "client_rejected_culture",
        "client_filled_internally",
        "client_filled_other",
        "other",
      ],
      hiring_context: ["new_role", "backfill"],
      job_status: ["draft", "open", "on_hold", "filled", "cancelled"],
      job_type: ["perm", "contract", "temp"],
      market_status: [
        "actively_looking",
        "passively_looking",
        "hot",
        "placed",
        "cold",
      ],
      placement_type: ["perm", "contract", "temp", "fixed_term"],
      spec_draft_status: [
        "pending",
        "transcribing",
        "ready_for_review",
        "approved",
        "rejected",
        "failed",
      ],
      user_role: ["owner", "admin", "recruiter"],
    },
  },
} as const