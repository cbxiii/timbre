import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  const { email, password } = await request.json();

  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password required" },
      { status: 400 }
    );
  }

  // Check if user already exists
  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", email)
    .single();

  if (existing) {
    return NextResponse.json(
      { error: "Account already exists" },
      { status: 409 }
    );
  }

  // Hash password — never store plain text
  const password_hash = await bcrypt.hash(password, 12);

  // Create the user
  const { data: newUser, error } = await supabase
    .from("profiles")
    .insert({ email, password_hash })
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { error: "Failed to create account" },
      { status: 500 }
    );
  }

  return NextResponse.json({ id: newUser.id, email: newUser.email });
}