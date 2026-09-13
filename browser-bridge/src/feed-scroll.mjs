// CDP wheel input can await compositor acknowledgement indefinitely in hidden
// tabs. Scroll the page's actual DOM scroll surface without foregrounding it.
export async function scrollFeedPage(page, selector, fallback = 950) {
  return page.evaluate(({selector, fallback}) => {
    const card = document.querySelector(selector);
    let scroller = card?.parentElement;
    while (scroller && !(scroller.scrollHeight > scroller.clientHeight && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
    const target = scroller || document.scrollingElement;
    if (!target) throw new Error('No document scroll surface');
    const before = target.scrollTop;
    const distance = Math.max(120, Math.min(fallback, (scroller?.clientHeight || window.innerHeight) * 0.9));
    target.scrollBy({top:distance, behavior:'instant'});
    return {before, after:target.scrollTop, distance, nested:Boolean(scroller)};
  }, {selector, fallback});
}

export const nextStalePassCount = (previous, current, stale) => current > previous ? 0 : stale + 1;
