export const saveSettingsDebounced = window.saveSettingsDebounced || (() => {});
export const generateQuietPrompt = async () => "";
export const substituteParams = (text) => text;
export const saveChat = () => {};
export const reloadCurrentChat = () => {};
export const addOneMessage = () => {};
export const getRequestHeaders = () => ({});
export const appendMediaToMessage = () => {};

export const eventSource = window.MyApp ? window.MyApp.getContext().eventSource : { on: () => {}, emit: () => {} };
export const event_types = window.MyApp ? window.MyApp.getContext().event_types : {};
