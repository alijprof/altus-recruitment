// Placeholder until `supabase gen types typescript --local > src/types/database.ts`
// is run (Task 2). Keeping the export so the supabase client wrappers compile.
//
// Once generated, this file will contain the full Database type derived from
// the live schema — do not hand-edit.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string
          name: string
          slug: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          slug: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          slug?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          id: string
          organization_id: string
          email: string
          full_name: string | null
          role: 'owner' | 'admin' | 'recruiter'
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          organization_id: string
          email: string
          full_name?: string | null
          role?: 'owner' | 'admin' | 'recruiter'
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          email?: string
          full_name?: string | null
          role?: 'owner' | 'admin' | 'recruiter'
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      current_organization_id: {
        Args: Record<string, never>
        Returns: string
      }
    }
    Enums: {
      user_role: 'owner' | 'admin' | 'recruiter'
    }
    CompositeTypes: Record<string, never>
  }
}
