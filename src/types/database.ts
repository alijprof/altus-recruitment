// Placeholder. Once Supabase is provisioned locally, regenerate via:
//
//   pnpm exec supabase gen types typescript --local > src/types/database.ts
//
// The full schema (Task 2 migration) covers many more tables than appear
// here. This minimal shape is enough to keep the supabase clients and the
// current authenticated layout compiling. Task 3 onward will assume the
// generated types are in place — do not hand-edit further additions.

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
