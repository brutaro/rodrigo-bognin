"use server";

import { redirect } from "next/navigation";
import { assertSameOrigin, endSession, requireAuthenticatedPage } from "@/lib/auth";

export async function logoutAction() {
  await requireAuthenticatedPage();
  await assertSameOrigin();
  await endSession();
  redirect("/entrar");
}
