// "Install the app": the row in Me > Settings, the one card on Home, and the iPhone/iPad steps.
// Android and Chromebook get the browser's own install prompt (offline.ts promptInstall). iPhone and iPad
// have no prompt: the steps sheet says how to add the app to the Home Screen.
//
// Why the iPhone copy talks about keeping progress: Safari deletes a website's saved data (local storage,
// so the app's progress) "after seven days of Safari use without user interaction on the site", and "Web
// applications added to the home screen are not part of Safari and thus have their own counter of days of
// use" (WebKit, "Full Third-Party Cookie Blocking and More", 2020-03-24,
// https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/). The same isolation means a
// Home Screen app does not get what Safari saved (WebKit bug 181849, "by design": Home Screen apps are
// created without shared state with the browser, https://bugs.webkit.org/show_bug.cgi?id=181849). That is
// its own progress, and also its own service worker and saved app files (the blog post above counts
// "Service Worker registrations and cache" as website data). So the Home Screen app works offline only
// after it has been opened once with a connection, and the sheet says so (step 2). Android and Chromebook
// are not affected: an app installed from Chrome shares the browser's data.
// The steps follow Apple's iPhone User Guide (iOS 26 and 27,
// https://support.apple.com/guide/iphone/bookmark-a-website-iph42ab2f3a7/ios): in the default layout Share
// is under the More (•••) button; with the Bottom or Top tabs layout it is its own button; then "Add to
// Home Screen", where "Open as Web App" makes it work as an app (off, the icon only opens Safari).
import { useState, type MouseEvent } from 'react';
import { useApp } from './ctx';
import { Sheet } from './ui';
import { appleDevice, dismissInstallCard, installCardDismissed, promptInstall, useInstallWay } from './offline';

export const INSTALL_SUB = 'Works without internet after the first visit.';
// iPhone/iPad Home card: the Home Screen app has its own saved files, so its own first visit must be online.
const IOS_CARD_SUB = 'Works without internet once you open it online.';

// The iOS Share icon (a box with an arrow up), as Safari draws it.
const SHARE = 'M12 3v12M8 7l4-4 4 4M7 10H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1';
const PHONE = 'M8 2.5h8a2 2 0 0 1 2 2v15a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2zM11 18.5h2';
const WIFI = 'M2 8.8a15 15 0 0 1 20 0M5 12.4a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01';

/** The steps to add the app to the Home Screen on an iPhone or iPad. */
export function IosInstallSheet({ onClose }: { onClose: () => void }) {
  const device = appleDevice() || 'iPhone';
  return (
    <Sheet label="Add to your Home Screen" onClose={onClose} className="pa-inst">
      <h2 className="pa-sheet-title">Add to your Home Screen</h2>
      <p className="pa-sheet-sub">{INSTALL_SUB}</p>
      <p className="pa-inst-step">
        <span className="pa-inst-ic" aria-hidden="true">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={SHARE} /></svg>
        </span>
        <span>In Safari, tap <b>•••</b> then <b>Share</b> (or the Share button), then <b>Add to Home Screen</b>. Keep <b>Open as Web App</b> on, then tap <b>Add</b>.</span>
      </p>
      <p className="pa-inst-step">
        <span className="pa-inst-ic" aria-hidden="true">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={WIFI} /></svg>
        </span>
        <span>Then open it once from your Home Screen while you&rsquo;re online.</span>
      </p>
      <p className="pa-inst-why">Add it to your Home Screen so your progress stays on this {device}. Safari can erase a website&rsquo;s saved progress after about 7 days without a visit.</p>
      <p className="pa-inst-fine">The Home Screen app keeps its own progress and its own copy of the app, so it starts fresh. What you saved in Safari stays in Safari.</p>
      <button type="button" className="pa-btn green press" onClick={onClose}>Got it</button>
    </Sheet>
  );
}

/** Me > Settings: "Install the app". Hidden once installed, and where the browser can't install. */
export function InstallRow({ onIos }: { onIos: () => void }) {
  const { sfx } = useApp();
  const way = useInstallWay();
  if (!way) return null;
  const go = (e: MouseEvent<HTMLButtonElement>) => {
    sfx('tap');
    if (way === 'ios') { onIos(); return; }
    // The browser's prompt can be shown once, so this row goes as soon as it opens: focus moves to the
    // Settings sheet first instead of falling to the top of the page.
    e.currentTarget.closest<HTMLElement>('[role="dialog"]')?.focus({ preventScroll: true });
    promptInstall().then((r) => { if (r !== 'unavailable') dismissInstallCard(); });
  };
  return (
    <button type="button" className="me-row" onClick={go} aria-haspopup={way === 'ios' ? 'dialog' : undefined}>
      <span className="me-row-text">
        <span className="me-row-name">Install the app</span>
        <span className="me-row-sub">{INSTALL_SUB}</span>
      </span>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5C625D" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
    </button>
  );
}

/** Home: one card that suggests installing, from the second day of practice, until it is used or dismissed.
    On an iPhone or iPad, "Show me" opens the steps (onIos: the screen shows the sheet, outside its scrolling
    body, and calls `done` when the sheet closes). The card stays while its sheet is open, so the sheet can give
    focus back to it; when the card goes, focusAfter moves focus to a place on Home that stays (else keyboard
    and screen reader focus would fall to the top of the page with the button that had it). */
export function InstallCard({ onIos, focusAfter }: { onIos: (done: () => void) => void; focusAfter: () => void }) {
  const { p, sfx } = useApp();
  const way = useInstallWay();
  const [gone, setGone] = useState(() => installCardDismissed());
  if (!way || gone || p.days.length < 2) return null;
  const close = (refocus = true) => { dismissInstallCard(); if (refocus) focusAfter(); setGone(true); };
  const go = () => {
    sfx('tap');
    if (way === 'ios') { onIos(() => close()); return; }
    // The browser's prompt can be shown once, so the card goes as soon as it opens (useInstallWay): focus first.
    focusAfter();
    promptInstall().then((r) => { if (r !== 'unavailable') close(false); });
  };
  return (
    <section className="hm-sec hm-s-inst fx-fadeup" aria-labelledby="home-inst">
      <div className="hm-inst">
        <span className="hm-inst-ic" aria-hidden="true">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d={PHONE} /></svg>
        </span>
        <div className="hm-inst-text">
          <h2 id="home-inst" className="hm-inst-h">{way === 'ios' ? 'Add it to your Home Screen' : 'Get the app'}</h2>
          <p className="hm-inst-sub">{way === 'ios' ? IOS_CARD_SUB : INSTALL_SUB}</p>
        </div>
        <button type="button" className="hm-inst-go press" onClick={go} aria-haspopup={way === 'ios' ? 'dialog' : undefined}>
          {way === 'ios' ? 'Show me' : 'Install'}
        </button>
        <button type="button" className="hm-inst-x" onClick={() => { sfx('tap'); close(); }} aria-label="Not now">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
    </section>
  );
}
