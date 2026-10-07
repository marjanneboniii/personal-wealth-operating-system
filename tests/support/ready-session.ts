import {eq} from "drizzle-orm";
import {db} from "../../src/db";
import {userSetupState} from "../../src/db/schema";
/** App fixtures explicitly represent users who finished the mandatory wizard. */
export async function createReadySession(userId: string) {
  const rows=await db.update(userSetupState).set({completed:true,currentStep:9}).where(eq(userSetupState.userId,userId)).returning({id:userSetupState.id});
  if(!rows.length) await db.insert(userSetupState).values({userId,completed:true,currentStep:9});
  return (await import("../../src/lib/auth")).createSession(userId);
}

export async function clearSetupReceipts() { await db.delete(userSetupState); }
