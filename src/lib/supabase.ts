import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// This creates a single instance of the Supabase client we can use anywhere
export const supabase = createClient(supabaseUrl, supabaseKey);