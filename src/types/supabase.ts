/**
 * Supabase Database Types
 * 
 * Tento soubor obsahuje TypeScript typy pro Supabase databázové schéma.
 * 
 * PRO VYGENEROVÁNÍ SPRÁVNÝCH TYPŮ:
 * 
 * 1. Přihlaste se do Supabase CLI:
 *    supabase login
 * 
 * 2. Linkněte projekt (pokud ještě není linknutý):
 *    supabase link --project-ref <YOUR_PROJECT_REF>
 * 
 * 3. Vygenerujte typy:
 *    npx supabase gen types typescript --linked > src/types/supabase.ts
 * 
 * NEBO použijte remote projekt přímo:
 *    npx supabase gen types typescript --project-id <YOUR_PROJECT_REF> > src/types/supabase.ts
 * 
 * POZOR: Tento soubor je placeholder. Skutečné typy musí být vygenerovány pomocí Supabase CLI.
 * 
 * Pro teď je zde základní struktura, která umožní wrapper fungovat.
 * Po vygenerování správných typů bude tento komentář nahrazen skutečnými typy.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      customers: {
        Row: {
          id: string
          service_id: string
          name: string
          phone: string | null
          email: string | null
          address_street: string | null
          address_city: string | null
          address_zip: string | null
          address_country: string | null
          company: string | null
          ico: string | null
          dic: string | null
          info: string | null
          note: string | null
          phone_norm: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          service_id: string
          name: string
          phone?: string | null
          email?: string | null
          address_street?: string | null
          address_city?: string | null
          address_zip?: string | null
          address_country?: string | null
          company?: string | null
          ico?: string | null
          dic?: string | null
          info?: string | null
          note?: string | null
          phone_norm?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          service_id?: string
          name?: string
          phone?: string | null
          email?: string | null
          address_street?: string | null
          address_city?: string | null
          address_zip?: string | null
          address_country?: string | null
          company?: string | null
          ico?: string | null
          dic?: string | null
          info?: string | null
          note?: string | null
          phone_norm?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      tickets: {
        Row: {
          id: string
          service_id: string
          title: string
          status: string
          notes: string
          created_at: string
          updated_at: string | null
          customer_name: string | null
          customer_phone: string | null
          customer_email: string | null
          customer_address_street: string | null
          customer_address_city: string | null
          customer_address_zip: string | null
          customer_address_country: string | null
          customer_company: string | null
          customer_ico: string | null
          customer_info: string | null
          device_condition: string | null
          device_note: string | null
          device_label: string | null
          device_brand: string | null
          device_model: string | null
          device_serial: string | null
          device_imei: string | null
          device_passcode: string | null
          estimated_price: number | null
          external_id: string | null
          handoff_method: string | null
          performed_repairs: Json
          diagnostic_text: string | null
          diagnostic_photos: Json
          discount_type: string | null
          discount_value: number | null
          customer_id: string | null
          code: string | null
          deleted_at: string | null
        }
        Insert: {
          id?: string
          service_id: string
          title?: string
          status?: string
          notes?: string
          created_at?: string
          updated_at?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          customer_email?: string | null
          customer_address_street?: string | null
          customer_address_city?: string | null
          customer_address_zip?: string | null
          customer_address_country?: string | null
          customer_company?: string | null
          customer_ico?: string | null
          customer_info?: string | null
          device_condition?: string | null
          device_note?: string | null
          device_label?: string | null
          device_brand?: string | null
          device_model?: string | null
          device_serial?: string | null
          device_imei?: string | null
          device_passcode?: string | null
          estimated_price?: number | null
          external_id?: string | null
          handoff_method?: string | null
          performed_repairs?: Json
          diagnostic_text?: string | null
          diagnostic_photos?: Json
          discount_type?: string | null
          discount_value?: number | null
          customer_id?: string | null
          code?: string | null
          deleted_at?: string | null
        }
        Update: {
          id?: string
          service_id?: string
          title?: string
          status?: string
          notes?: string
          created_at?: string
          updated_at?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          customer_email?: string | null
          customer_address_street?: string | null
          customer_address_city?: string | null
          customer_address_zip?: string | null
          customer_address_country?: string | null
          customer_company?: string | null
          customer_ico?: string | null
          customer_info?: string | null
          device_condition?: string | null
          device_note?: string | null
          device_label?: string | null
          device_brand?: string | null
          device_model?: string | null
          device_serial?: string | null
          device_imei?: string | null
          device_passcode?: string | null
          estimated_price?: number | null
          external_id?: string | null
          handoff_method?: string | null
          performed_repairs?: Json
          diagnostic_text?: string | null
          diagnostic_photos?: Json
          discount_type?: string | null
          discount_value?: number | null
          customer_id?: string | null
          code?: string | null
          deleted_at?: string | null
        }
        Relationships: []
      }
      services: {
        Row: {
          id: string
          name: string
          created_at: string | null
        }
        Insert: {
          id?: string
          name: string
          created_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          created_at?: string | null
        }
        Relationships: []
      }
      service_statuses: {
        Row: {
          service_id: string
          key: string
          label: string
          bg: string | null
          fg: string | null
          is_final: boolean
          order_index: number
        }
        Insert: {
          service_id: string
          key: string
          label: string
          bg?: string | null
          fg?: string | null
          is_final?: boolean
          order_index?: number
        }
        Update: {
          service_id?: string
          key?: string
          label?: string
          bg?: string | null
          fg?: string | null
          is_final?: boolean
          order_index?: number
        }
        Relationships: []
      }
      // TODO: Přidat další tabulky po vygenerování správných typů
      // service_memberships, service_invites, service_settings, atd.
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

