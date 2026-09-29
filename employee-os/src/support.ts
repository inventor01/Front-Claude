export type SupportCategory='SHIPPING'|'RETURNS_REFUNDS'|'ORDER_STATUS'|'PRODUCT_USAGE'|'BILLING'|'ACCOUNT'|'OTHER';

const clean=(v:string)=>String(v||'').replace(/\s+/g,' ').trim();

export function classifySupportCase(subject:string,message:string){
  const text=`${subject} ${message}`.toLowerCase();
  let category:SupportCategory='OTHER';
  if(/refund|return|money back|send it back|exchange/.test(text))category='RETURNS_REFUNDS';
  else if(/where.*order|order status|tracking|track my|has.*shipped|delivery status/.test(text))category='ORDER_STATUS';
  else if(/shipping|delivery|arrive|arrival|how long.*ship/.test(text))category='SHIPPING';
  else if(/charged|charge|billing|payment|card|duplicate.*charge/.test(text))category='BILLING';
  else if(/login|sign in|account|password/.test(text))category='ACCOUNT';
  else if(/work on|works on|how.*use|compatible|compatibility|setup|install|use it|does this work/.test(text))category='PRODUCT_USAGE';

  const severity=/chargeback|fraud|unauthorized charge|legal|injur|unsafe|emergency/.test(text)
    ?'HIGH'
    : /refund|charged twice|missing order|never arrived/.test(text)
      ?'MEDIUM'
      :'LOW';

  return {category,severity};
}

export function supportPatternKey(category:SupportCategory,message:string){
  const text=clean(message).toLowerCase();
  const known=[
    ['carpet',/\bcarpet\b/],['shipping-time',/\b(ship|shipping|arrive|delivery)\b/],
    ['tracking',/\b(track|tracking)\b/],['refund',/\brefund\b/],['return',/\breturn\b/],
    ['compatibility',/\b(compatible|compatibility)\b/],['setup',/\b(setup|install)\b/]
  ] as const;
  const hit=known.find(([,re])=>re.test(text));
  if(hit)return `${category}:${hit[0]}`;
  const stop=new Set(['this','that','with','your','have','does','will','what','when','where','would','could','please','help','order']);
  const tokens=[...new Set(text.split(/[^a-z0-9]+/).filter(x=>x.length>=4&&!stop.has(x)))].sort().slice(0,3);
  return `${category}:${tokens.join('-')||'general'}`;
}

export function draftSupportResponse(input:{
  category:SupportCategory;subject:string;message:string;customerRef:string;
}){
  const opening='Thanks for reaching out. I can help with this.';
  const safeAccount='I do not have a verified connected order/account record for this customer in the current support runtime, so I will not guess about order status, charges, refunds, or delivery.';
  const next:Record<SupportCategory,string>={
    SHIPPING:'Once the support/store connection is available, I’ll verify the order, carrier status, and the exact shipping next step.',
    ORDER_STATUS:'Once the support/store connection is available, I’ll verify the order and tracking record before giving you a status.',
    RETURNS_REFUNDS:'Once the support/store connection is available, I’ll verify the order and applicable return/refund policy before taking any action.',
    BILLING:'Once the support/store connection is available, I’ll verify the transaction record before discussing or changing any charge.',
    ACCOUNT:'Once the account system is connected, I’ll verify the account state and use the approved recovery process.',
    PRODUCT_USAGE:'I can answer product-use questions only from verified product information. If the detail is not in the connected knowledge base, I’ll escalate rather than invent an answer.',
    OTHER:'I’ll verify the relevant account, product, or policy context before giving a definitive resolution.'
  };
  return `${opening}\n\n${safeAccount}\n\n${next[input.category]}\n\nYour message is recorded and ready for a verified follow-up.`;
}

export function qaSupportDraft(draft:string){
  const failures:string[]=[];
  if(clean(draft).length<80)failures.push('draft too short');
  const risky=[
    /your refund (?:has been|was) issued/i,
    /your order (?:has )?shipped/i,
    /tracking number is/i,
    /we charged you/i,
    /guaranteed/i,
    /i checked your order/i
  ];
  if(risky.some(re=>re.test(draft)))failures.push('draft contains an unverified account/action claim');
  return {
    passed:failures.length===0,
    failures,
    checks:['response is substantive','no fake refund/shipping/account claim','no guarantee language','explicit verification boundary']
  };
}
