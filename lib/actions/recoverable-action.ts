import { reportClientError } from "../client-errors.ts";

type ActionState = { error?: string; incidentId?: string };

export async function runRecoverableAction<State extends ActionState>(
  action: (previous: State, formData: FormData) => Promise<State>,
  previous: State,
  formData: FormData,
  initialState: State,
): Promise<State> {
  try {
    return await action(previous, formData);
  } catch (error) {
    return {
      ...initialState,
      error: "暂未收到提交结果，输入内容仍保留，请重试。",
      incidentId: reportClientError(error, "action"),
    };
  }
}
