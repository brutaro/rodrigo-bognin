"use server";

import { redirect } from "next/navigation";
import { assertSameOrigin, attemptLogin, establishSession } from "@/lib/auth";

export async function loginAction(formData: FormData) {
  await assertSameOrigin();
  const value = formData.get("codigo");
  const code = typeof value === "string" ? value : "";
  if (!(await attemptLogin(code))) redirect("/entrar?erro=credenciais");
  await establishSession();
  redirect("/");
}
