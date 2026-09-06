/**
 * Wrappers over the `homebridge` object the Homebridge UI injects into the settings iframe.
 * Every server call shows the UI's spinner while it runs and never throws to the caller.
 */

export interface ServerResult<T> {
  ok: boolean;
  message: string;
  data?: T;
}

function hb(): Window['homebridge'] {
  return window.homebridge;
}

export async function callServer<T extends { ok: boolean; message: string }>(path: string, payload: unknown): Promise<T> {
  hb().showSpinner();
  try {
    const result = (await hb().request(path, payload)) as T;
    if (!result || typeof result !== 'object' || typeof result.ok !== 'boolean') {
      return { ok: false, message: 'The server did not answer in the expected format.' } as T;
    }
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Could not reach the plugin server: ${message}` } as T;
  } finally {
    hb().hideSpinner();
  }
}

export function toastError(message: string): void {
  hb().toast.error(message, 'Notify Switch');
}

export function toastSuccess(message: string): void {
  hb().toast.success(message, 'Notify Switch');
}

export function setSaveEnabled(enabled: boolean): void {
  if (enabled) {
    hb().enableSaveButton();
  } else {
    hb().disableSaveButton();
  }
}
