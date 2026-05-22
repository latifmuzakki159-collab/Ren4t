export class Popup {
  constructor(content, type) {
    if (window.toastr) {
      window.toastr.info("Popup: " + content);
    }
  }
}
export const POPUP_TYPE = {
  TEXT: 0,
  CONFIRM: 1,
  INPUT: 2
};
