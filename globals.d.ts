/*
 * Ambient types for the vanilla DOM app (see tsconfig.json — checking only,
 * no build). The code reads element-specific props (.value/.checked/…) off the
 * base types that getElementById/querySelector return, uses a couple of expando
 * properties, and references a few runtime-loaded externals. Declaring those
 * here once keeps `npm run typecheck` enforceable and meaningful — it still
 * catches undefined names, bad argument types and typos in the app's own
 * logic — without scattering ~100 inline casts through otherwise-correct code.
 */

interface Element {
  value: string;
  checked: boolean;
  disabled: boolean;
  dataset: DOMStringMap;
  style: CSSStyleDeclaration;
  hidden: boolean | string;
  offsetParent: Element | null;
  offsetTop: number;
  offsetHeight: number;
  tabIndex: number;
  onclick: ((e: any) => any) | null;
  onkeydown: ((e: any) => any) | null;
  onchange: ((e: any) => any) | null;
  oninput: ((e: any) => any) | null;
  focus(options?: any): void;
  blur(): void;
  click(): void;
  scrollIntoView(arg?: boolean | object): void;
}

interface HTMLElement {
  width: number;
  height: number;
  getContext(id: string): any;
  /** swipe-to-delete bookkeeping (app.ui.js) */
  _swipeDeleting?: boolean;
  _cancelSwipe?: () => void;
}

interface EventTarget {
  tagName: string;
  type: string;
  value: string;
  closest(selectors: string): Element | null;
  scrollIntoView(arg?: boolean | object): void;
}

interface Node {
  // DOM event handlers give us EventTarget; the app guards with a truthiness
  // check before these calls, so widening the param here is safe.
  contains(other: EventTarget | null): boolean;
}

interface Navigator {
  /** legacy iOS standalone-PWA flag */
  standalone?: boolean;
}

interface Window {
  webkitSpeechRecognition?: any;
  SpeechRecognition?: any;
  _splashTimer?: any;
  _saveTimeout?: any;
}

// Google Identity Services — loaded at runtime from accounts.google.com/gsi/client
declare var google: any;
