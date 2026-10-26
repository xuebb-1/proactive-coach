import { UserInputError } from "./user-error";
import { OperationBusyError } from "./operations";

export async function publicAction(fn: () => Promise<void>): Promise<{ error?: string }> {
  try {
    await fn();
    return {};
  } catch (error) {
    if (error instanceof UserInputError || error instanceof OperationBusyError) return { error: error.message };
    console.error("Action failed", error);
    return { error: "这次操作未完成，请稍后重试。" };
  }
}
