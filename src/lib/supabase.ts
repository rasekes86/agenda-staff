import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://iugutcsukxkxlgpkmzxt.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1Z3V0Y3N1a3hreGxncGttenh0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzc5OTExMjksImV4cCI6MjA1MzU2NzEyOX0.PpolAzqqXNBOhRlUVzplqkKeGQxzfed4gH377CidVJE'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Tipos para los eventos
export interface CalendarEvent {
  id: string
  title: string
  description: string | null
  date: string
  time: string | null
  color: string
  created_at: string
  updated_at: string
}

export type CalendarEventInsert = Omit<CalendarEvent, 'created_at' | 'updated_at'>
export type CalendarEventUpdate = Partial<CalendarEventInsert>
