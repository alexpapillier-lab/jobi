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
          device_accessories: string | null
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
          handback_method: string | null
          performed_repairs: Json
          diagnostic_text: string | null
          diagnostic_photos: Json
          discount_type: string | null
          discount_value: number | null
          customer_id: string | null
          code: string | null
          deleted_at: string | null
          expected_completion_at: string | null
          completed_at: string | null
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
          device_accessories?: string | null
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
          handback_method?: string | null
          performed_repairs?: Json
          diagnostic_text?: string | null
          diagnostic_photos?: Json
          discount_type?: string | null
          discount_value?: number | null
          customer_id?: string | null
          code?: string | null
          deleted_at?: string | null
          expected_completion_at?: string | null
          completed_at?: string | null
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
          device_accessories?: string | null
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
          handback_method?: string | null
          performed_repairs?: Json
          diagnostic_text?: string | null
          diagnostic_photos?: Json
          discount_type?: string | null
          discount_value?: number | null
          customer_id?: string | null
          code?: string | null
          deleted_at?: string | null
          expected_completion_at?: string | null
          completed_at?: string | null
        }
        Relationships: []
      }
      warranty_claims: {
        Row: {
          id: string
          service_id: string
          source_ticket_id: string | null
          code: string
          status: string
          notes: string
          resolution_summary: string | null
          received_at: string | null
          released_at: string | null
          created_at: string
          updated_at: string | null
          customer_id: string | null
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
          device_accessories: string | null
          device_note: string | null
          device_label: string | null
          device_brand: string | null
          device_model: string | null
          device_serial: string | null
          device_imei: string | null
          device_passcode: string | null
          expected_completion_at: string | null
          completed_at: string | null
        }
        Insert: {
          id?: string
          service_id: string
          source_ticket_id?: string | null
          code: string
          status?: string
          notes?: string
          resolution_summary?: string | null
          received_at?: string | null
          released_at?: string | null
          created_at?: string
          updated_at?: string | null
          customer_id?: string | null
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
          device_accessories?: string | null
          device_note?: string | null
          device_label?: string | null
          device_brand?: string | null
          device_model?: string | null
          device_serial?: string | null
          device_imei?: string | null
          device_passcode?: string | null
          expected_completion_at?: string | null
          completed_at?: string | null
        }
        Update: {
          id?: string
          service_id?: string
          source_ticket_id?: string | null
          code?: string
          status?: string
          notes?: string
          resolution_summary?: string | null
          received_at?: string | null
          released_at?: string | null
          created_at?: string
          updated_at?: string | null
          customer_id?: string | null
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
          device_accessories?: string | null
          device_note?: string | null
          device_label?: string | null
          device_brand?: string | null
          device_model?: string | null
          device_serial?: string | null
          device_imei?: string | null
          device_passcode?: string | null
        }
        Relationships: []
      }
      warranty_claim_history: {
        Row: {
          id: string
          warranty_claim_id: string
          service_id: string
          action: string
          changed_by: string | null
          details: Json
          created_at: string
        }
        Insert: {
          id?: string
          warranty_claim_id: string
          service_id: string
          action: string
          changed_by?: string | null
          details?: Json
          created_at?: string
        }
        Update: {
          id?: string
          warranty_claim_id?: string
          service_id?: string
          action?: string
          changed_by?: string | null
          details?: Json
          created_at?: string
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
      profiles: {
        Row: {
          id: string
          nickname: string | null
          avatar_url: string | null
          updated_at: string | null
        }
        Insert: {
          id: string
          nickname?: string | null
          avatar_url?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          nickname?: string | null
          avatar_url?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      invoices: {
        Row: {
          id: string
          service_id: string
          customer_id: string | null
          ticket_id: string | null
          number: string
          variable_symbol: string | null
          status: string
          issue_date: string
          due_date: string
          taxable_date: string | null
          paid_at: string | null
          sent_at: string | null
          currency: string
          subtotal: number
          vat_amount: number
          total: number
          rounding: number
          supplier_name: string | null
          supplier_ico: string | null
          supplier_dic: string | null
          supplier_address: string | null
          supplier_email: string | null
          supplier_phone: string | null
          supplier_bank_account: string | null
          supplier_iban: string | null
          supplier_swift: string | null
          customer_name: string | null
          customer_ico: string | null
          customer_dic: string | null
          customer_address: string | null
          customer_email: string | null
          customer_phone: string | null
          notes: string | null
          internal_note: string | null
          created_at: string
          updated_at: string | null
          deleted_at: string | null
        }
        Insert: {
          id?: string
          service_id: string
          customer_id?: string | null
          ticket_id?: string | null
          number: string
          variable_symbol?: string | null
          status?: string
          issue_date?: string
          due_date?: string
          taxable_date?: string | null
          paid_at?: string | null
          sent_at?: string | null
          currency?: string
          subtotal?: number
          vat_amount?: number
          total?: number
          rounding?: number
          supplier_name?: string | null
          supplier_ico?: string | null
          supplier_dic?: string | null
          supplier_address?: string | null
          supplier_email?: string | null
          supplier_phone?: string | null
          supplier_bank_account?: string | null
          supplier_iban?: string | null
          supplier_swift?: string | null
          customer_name?: string | null
          customer_ico?: string | null
          customer_dic?: string | null
          customer_address?: string | null
          customer_email?: string | null
          customer_phone?: string | null
          notes?: string | null
          internal_note?: string | null
          created_at?: string
          updated_at?: string | null
          deleted_at?: string | null
        }
        Update: {
          id?: string
          service_id?: string
          customer_id?: string | null
          ticket_id?: string | null
          number?: string
          variable_symbol?: string | null
          status?: string
          issue_date?: string
          due_date?: string
          taxable_date?: string | null
          paid_at?: string | null
          sent_at?: string | null
          currency?: string
          subtotal?: number
          vat_amount?: number
          total?: number
          rounding?: number
          supplier_name?: string | null
          supplier_ico?: string | null
          supplier_dic?: string | null
          supplier_address?: string | null
          supplier_email?: string | null
          supplier_phone?: string | null
          supplier_bank_account?: string | null
          supplier_iban?: string | null
          supplier_swift?: string | null
          customer_name?: string | null
          customer_ico?: string | null
          customer_dic?: string | null
          customer_address?: string | null
          customer_email?: string | null
          customer_phone?: string | null
          notes?: string | null
          internal_note?: string | null
          created_at?: string
          updated_at?: string | null
          deleted_at?: string | null
        }
        Relationships: []
      }
      invoice_items: {
        Row: {
          id: string
          invoice_id: string
          sort_order: number
          name: string
          qty: number
          unit: string
          unit_price: number
          vat_rate: number
          line_total: number
          created_at: string
        }
        Insert: {
          id?: string
          invoice_id: string
          sort_order?: number
          name?: string
          qty?: number
          unit?: string
          unit_price?: number
          vat_rate?: number
          line_total?: number
          created_at?: string
        }
        Update: {
          id?: string
          invoice_id?: string
          sort_order?: number
          name?: string
          qty?: number
          unit?: string
          unit_price?: number
          vat_rate?: number
          line_total?: number
          created_at?: string
        }
        Relationships: []
      }
      invoice_events: {
        Row: {
          id: string
          invoice_id: string
          type: string
          payload: Json
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          invoice_id: string
          type: string
          payload?: Json
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          invoice_id?: string
          type?: string
          payload?: Json
          created_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      invoice_series: {
        Row: {
          id: string
          service_id: string
          prefix: string
          year: number
          next_value: number
          created_at: string
        }
        Insert: {
          id?: string
          service_id: string
          prefix?: string
          year?: number
          next_value?: number
          created_at?: string
        }
        Update: {
          id?: string
          service_id?: string
          prefix?: string
          year?: number
          next_value?: number
          created_at?: string
        }
        Relationships: []
      }
      service_phone_numbers: {
        Row: {
          id: string
          service_id: string
          twilio_number: string
          forwarding_number: string | null
          active: boolean
          provisioned_at: string
          twilio_sid: string | null
        }
        Insert: {
          id?: string
          service_id: string
          twilio_number: string
          forwarding_number?: string | null
          active?: boolean
          provisioned_at?: string
          twilio_sid?: string | null
        }
        Update: {
          id?: string
          service_id?: string
          twilio_number?: string
          forwarding_number?: string | null
          active?: boolean
          provisioned_at?: string
          twilio_sid?: string | null
        }
        Relationships: []
      }
      sms_conversations: {
        Row: {
          id: string
          service_id: string
          ticket_id: string | null
          customer_phone: string
          customer_name: string | null
          created_at: string
          updated_at: string
          archived: boolean
        }
        Insert: {
          id?: string
          service_id: string
          ticket_id?: string | null
          customer_phone: string
          customer_name?: string | null
          created_at?: string
          updated_at?: string
          archived?: boolean
        }
        Update: {
          id?: string
          service_id?: string
          ticket_id?: string | null
          customer_phone?: string
          customer_name?: string | null
          created_at?: string
          updated_at?: string
          archived?: boolean
        }
        Relationships: []
      }
      sms_messages: {
        Row: {
          id: string
          conversation_id: string
          direction: string
          body: string
          sent_at: string
          twilio_sid: string | null
          status: string | null
          read_at: string | null
        }
        Insert: {
          id?: string
          conversation_id: string
          direction: string
          body: string
          sent_at?: string
          twilio_sid?: string | null
          status?: string | null
          read_at?: string | null
        }
        Update: {
          id?: string
          conversation_id?: string
          direction?: string
          body?: string
          sent_at?: string
          twilio_sid?: string | null
          status?: string | null
          read_at?: string | null
        }
        Relationships: []
      }
      sms_automations: {
        Row: {
          id: string
          service_id: string
          trigger_status_key: string
          message_template: string
          active: boolean
          sort_order: number
          created_at: string
        }
        Insert: {
          id?: string
          service_id: string
          trigger_status_key: string
          message_template?: string
          active?: boolean
          sort_order?: number
          created_at?: string
        }
        Update: {
          id?: string
          service_id?: string
          trigger_status_key?: string
          message_template?: string
          active?: boolean
          sort_order?: number
          created_at?: string
        }
        Relationships: []
      }
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

