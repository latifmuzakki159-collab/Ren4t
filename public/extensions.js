export const extension_settings = window.extension_settings || {};

export function getContext() {
  if (window.MyApp && window.MyApp.getContext) {
    return window.MyApp.getContext();
  }
  return {
    eventSource: { on: () => {}, emit: () => {} },
    event_types: {},
    chat: {},
    settings: {},
    callLLM: async () => ""
  };
}
