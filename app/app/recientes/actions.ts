"use server";

import { revalidatePath } from "next/cache";
import { requireOrganizationContext } from "@/lib/auth/guards";
import { setContractFavorite } from "@/lib/domain/recent-contracts";
import { boolField, textField } from "@/app/app/_lib/action-result";

export async function alternarFavorito(data: FormData): Promise<void> {
  const context = await requireOrganizationContext();
  await setContractFavorite(
    context,
    textField(data, "contractId"),
    boolField(data, "favorite")
  );
  revalidatePath("/app/recientes");
}
