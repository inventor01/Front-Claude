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

export function feedExhausted(stale, movements) {
  return stale >= 6 && movements.length >= 4 && movements.slice(-4).every(item => item.after === item.before);
}

export async function collectVisibleFeeds(jobs) {
  const settled = [];
  for (const job of jobs) {
    try { settled.push({status:'fulfilled', value:await job()}); }
    catch (reason) { settled.push({status:'rejected', reason}); }
  }
  return settled;
}

// Only call for a temporary page owned by this collector.
export async function ensureOwnedPageVisible(page) {
 const before=await page.evaluate(()=>document.visibilityState);
 if(before!=='visible') {
  await page.bringToFront();
  await page.waitForFunction(()=>document.visibilityState==='visible',{}, {timeout:3000});
 }
 return {visibility:'visible',recovered:before!=='visible'};
}

export function currentTikTokSnapshot(stage, snapshot) {
 if(['pending','disabled'].includes(stage?.status))return {...stage,active:false,observed:0,grounded:0,sourcePages:[]};
 return snapshot;
}
