// verify-access-key — Supabase Edge Function (Deno)
//
// Replaces Supabase Auth invite emails with a PIN-based self-activation flow.
// Run: supabase functions deploy verify-access-key
//
// ENV VARS: SB_URL, SERVICE_ROLE_KEY

import {
  BadRequest,
  corsHeaders,
  jsonResponse,
  requireEnv,
  requireString,
  serviceClient,
} from "../_shared/lib.ts";

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin");

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, origin);
  }

  try {
    const payload = await request.json();

    const accessKey = requireString(payload.access_key, "access_key", 12);
    const email = requireString(payload.email, "email", 320);
    const password = requireString(payload.password, "password", 128);

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return jsonResponse({ error: "Enter a valid email." }, 400, origin);
    }
    if (password.length < 10) {
      return jsonResponse(
        { error: "Password must be at least 10 characters." },
        400,
        origin
      );
    }

    const admin = serviceClient();

    const { data: client, error: clientError } = await admin
      .from("clients")
      .select("id, business_name, email")
      .eq("access_key", accessKey)
      .maybeSingle();

    if (clientError || !client) {
      return jsonResponse(
        { error: "That access key is not valid." },
        403,
        origin
      );
    }

    if (client.email && client.email.toLowerCase() !== email.toLowerCase()) {
      return jsonResponse(
        { error: "Email does not match the access key." },
        403,
        origin
      );
    }

    const { data: authData, error: signUpError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { business_name: client.business_name },
    });

    if (signUpError) {
      if (signUpError.message?.toLowerCase().includes("already")) {
        const { data: existing } = await admin.auth.admin.listUsers({
          filter: email,
        });
        const user = existing?.users?.[0];
        if (!user) {
          return jsonResponse(
            { error: "Could not activate. Contact hello@dasdev.net." },
            500,
            origin
          );
        }

        const { error: pwError } = await admin.auth.admin.updateUserById(
          user.id,
          { password }
        );
        if (pwError) throw pwError;

        const { error: profileError } = await admin
          .from("profiles")
          .update({ role: "client", client_id: client.id })
          .eq("id", user.id);
        if (profileError) throw profileError;

        await admin
          .from("clients")
          .update({ access_key: null, access_key_created_at: null })
          .eq("id", client.id);

        return jsonResponse({ ok: true, client_id: client.id }, 200, origin);
      }
      throw signUpError;
    }

    if (!authData.user) {
      return jsonResponse({ error: "Activation failed." }, 500, origin);
    }

    const { error: profileError } = await admin
      .from("profiles")
      .update({ role: "client", client_id: client.id })
      .eq("id", authData.user.id);

    if (profileError) throw profileError;

    await admin
      .from("clients")
      .update({ access_key: null, access_key_created_at: null })
      .eq("id", client.id);

    return jsonResponse({ ok: true, client_id: client.id }, 200, origin);
  } catch (error) {
    if (error instanceof BadRequest) {
      return jsonResponse({ error: error.message }, 400, origin);
    }
    return jsonResponse({ error: "Could not activate." }, 500, origin);
  }
});
