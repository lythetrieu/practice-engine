// Map backgrounds for the Learn screen, drawn for a 390 x 696 frame:
// World 1 park and World 2 bridge + city (worlds 3-6 reuse them: odd = park, even = bridge).
// The road is split into one segment per stop so the dotted trail can follow real progress.

export const PARK_SPOTS: [number, number][] = [[128, 154], [262, 232], [140, 311], [262, 390], [128, 469], [258, 548], [178, 627]];
export const BRIDGE_SPOTS: [number, number][] = [[140, 150], [255, 213], [140, 276], [255, 339], [140, 402], [255, 465], [190, 528]];

// 'M' start, then one cubic segment per stop (each ends on that stop's centre), then the tail off the bottom
// (it runs straight on far below the frame, for a map frame taller than the drawing on a tall screen).
const PARK_ROAD = ["M188 -40","C178 -7.7 115.7 108.7 128 154","C140.3 199.3 260 205.8 262 232","C264 258.2 140 284.7 140 311","C140 337.3 264 363.7 262 390","C260 416.3 128.7 442.7 128 469","C127.3 495.3 249.7 521.7 258 548","C266.3 574.3 190.3 591.7 178 627","C165.7 662.3 183 737.8 184 760L184 1600"];
const BRIDGE_ROAD = ["M200 -40","C190 -8.3 130.8 107.8 140 150","C149.2 192.2 255 192 255 213","C255 234 140 255 140 276","C140 297 255 318 255 339","C255 360 140 381 140 402","C140 423 246.7 444 255 465","C263.3 486 199.8 478.8 190 528","C180.2 577.2 195 721.3 196 760L196 1600"];

// path from the top edge to stop `upTo` (0-6), for the dotted trail of finished levels
export const trailPath = (park: boolean, upTo: number) => (park ? PARK_ROAD : BRIDGE_ROAD).slice(0, upTo + 2).join(' ');

export function ParkMap({ trail }: { trail: string }) {
  const d = PARK_ROAD.join(' ');
  return (
    <svg className="ln-bg" width="390" height="696" viewBox="0 0 390 696" preserveAspectRatio="xMidYMin meet" aria-hidden="true">
      <rect width="390" height="1600" fill="var(--frame)" />
      <g fill="#DDEBD5">
      <ellipse cx="40" cy="300" rx="84" ry="56" />
      <ellipse cx="356" cy="420" rx="84" ry="62" />
      <ellipse cx="350" cy="168" rx="70" ry="44" />
      <ellipse cx="70" cy="520" rx="74" ry="44" />
      <ellipse cx="260" cy="660" rx="96" ry="40" />
      </g>
      <ellipse cx="72" cy="628" rx="50" ry="25" fill="#CFE3E0" stroke="#B2D1CC" strokeWidth="3" />
      <path d="M50 624q8-5 16 0M76 634q8-5 16 0" fill="none" stroke="#E6F0EE" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M118 616v-12M123 618v-17M128 617v-10" fill="none" stroke="var(--sage)" strokeWidth="2.5" strokeLinecap="round" />
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d={d} stroke="#D8C8AE" strokeWidth="40" />
        <path d={d} stroke="#F7F0E3" strokeWidth="32" />
        <path d={d} stroke="#E2D3BA" strokeWidth="3" strokeDasharray="3 12" />
        <path d={trail} stroke="var(--sage)" strokeWidth="5" strokeDasharray="1 13" />
      </g>
      <ellipse cx="40" cy="248" rx="14.4" ry="4" fill="#D2E2CA" /><rect x="37.5" y="228.8" width="5" height="19.2" rx="2" fill="#9C8B73" /><circle cx="40" cy="222" r="17" fill="#A9CBA0" /><circle cx="34.4" cy="216.4" r="7.7" fill="#BCD8B3" /><ellipse cx="352" cy="322" rx="14.4" ry="4" fill="#D2E2CA" /><rect x="349.5" y="302.8" width="5" height="19.2" rx="2" fill="#9C8B73" /><circle cx="352" cy="296" r="17" fill="#A9CBA0" /><circle cx="346.4" cy="290.4" r="7.7" fill="#BCD8B3" /><ellipse cx="30" cy="428" rx="12.8" ry="4" fill="#D2E2CA" /><rect x="27.5" y="410" width="5" height="18" rx="2" fill="#9C8B73" /><circle cx="30" cy="404" r="15" fill="#A9CBA0" /><circle cx="25.1" cy="399.1" r="6.8" fill="#BCD8B3" /><ellipse cx="358" cy="499" rx="13.6" ry="4" fill="#D2E2CA" /><rect x="355.5" y="480.4" width="5" height="18.6" rx="2" fill="#9C8B73" /><circle cx="358" cy="474" r="16" fill="#A9CBA0" /><circle cx="352.7" cy="468.7" r="7.2" fill="#BCD8B3" /><ellipse cx="346" cy="667" rx="15.3" ry="4" fill="#D2E2CA" /><rect x="343.5" y="647.2" width="5" height="19.8" rx="2" fill="#9C8B73" /><circle cx="346" cy="640" r="18" fill="#A9CBA0" /><circle cx="340.1" cy="634.1" r="8.1" fill="#BCD8B3" /><ellipse cx="236" cy="154" rx="11" ry="4" fill="#D2E2CA" /><rect x="233.5" y="137.2" width="5" height="16.8" rx="2" fill="#9C8B73" /><circle cx="236" cy="132" r="13" fill="#A9CBA0" /><circle cx="231.7" cy="127.7" r="5.9" fill="#BCD8B3" /><ellipse cx="20" cy="582" rx="11" ry="4" fill="#D2E2CA" /><rect x="17.5" y="565.2" width="5" height="16.8" rx="2" fill="#9C8B73" /><circle cx="20" cy="560" r="13" fill="#A9CBA0" /><circle cx="15.7" cy="555.7" r="5.9" fill="#BCD8B3" /><circle cx="308.3" cy="332.2" r="8.8" fill="#A9CBA0" /><circle cx="321.5" cy="330" r="11" fill="#A9CBA0" /><circle cx="318.2" cy="326.7" r="5" fill="#BCD8B3" /><circle cx="63" cy="332" r="8" fill="#A9CBA0" /><circle cx="75" cy="330" r="10" fill="#A9CBA0" /><circle cx="72" cy="327" r="4.5" fill="#BCD8B3" /><circle cx="293" cy="612" r="8" fill="#A9CBA0" /><circle cx="305" cy="610" r="10" fill="#A9CBA0" /><circle cx="302" cy="607" r="4.5" fill="#BCD8B3" /><circle cx="205.7" cy="471.8" r="7.2" fill="#A9CBA0" /><circle cx="216.5" cy="470" r="9" fill="#A9CBA0" /><circle cx="213.8" cy="467.3" r="4" fill="#BCD8B3" /><circle cx="64" cy="160" r="3.5" fill="var(--accent)" /><circle cx="72" cy="166" r="3" fill="#FFFFFF" /><circle cx="326" cy="232" r="3.5" fill="#FFFFFF" /><circle cx="334" cy="238" r="3" fill="var(--accent)" /><circle cx="40" cy="470" r="3.5" fill="#FFFFFF" /><circle cx="48" cy="476" r="3" fill="var(--accent)" /><circle cx="330" cy="548" r="3.5" fill="var(--accent)" /><circle cx="338" cy="554" r="3" fill="#FFFFFF" /><circle cx="238" cy="662" r="3.5" fill="#FFFFFF" /><circle cx="246" cy="668" r="3" fill="var(--accent)" /><circle cx="196" cy="404" r="3.5" fill="var(--accent)" /><circle cx="204" cy="410" r="3" fill="#FFFFFF" /><path d="M24 290l3-7 3 7M80 252l3-7 3 7M300 196l3-7 3 7M366 380l3-7 3 7M204 560l3-7 3 7M110 556l3-7 3 7M300 520l3-7 3 7M60 690l3-7 3 7M262 300l3-7 3 7M90 112l3-7 3 7" fill="none" stroke="#C6DABE" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// fog: a closed world gets a light wash
export function BridgeMap({ fog, trail }: { fog: boolean; trail: string }) {
  const d = BRIDGE_ROAD.join(' ');
  return (
    <svg className="ln-bg" width="390" height="696" viewBox="0 0 390 696" preserveAspectRatio="xMidYMin meet" aria-hidden="true">
      <rect width="390" height="1600" fill="#E1E5DC" />
      <path d="M74 0C58 110 98 230 70 350S92 590 66 696V1600H324V696C346 580 300 460 326 340S302 110 322 0Z" fill="#CFE3E0" stroke="#B2D1CC" strokeWidth="3" />
      <path d="M96 196q9-5 18 0M290 260q9-5 18 0M88 452q9-5 18 0M286 560q9-5 18 0M300 410q9-5 18 0M100 330q9-5 18 0" fill="none" stroke="#E6F0EE" strokeWidth="3" strokeLinecap="round" />
      <rect x="0" y="214" width="38" height="96" rx="3" fill="#C9D3C8" /><path d="M10 223h6v8h-6ZM22 223h6v8h-6ZM10 239h6v8h-6ZM22 239h6v8h-6ZM10 255h6v8h-6ZM22 255h6v8h-6ZM10 271h6v8h-6ZM22 271h6v8h-6ZM10 287h6v8h-6ZM22 287h6v8h-6Z" fill="#E4E9E1" /><rect x="8" y="322" width="48" height="78" rx="3" fill="#C9D3C8" /><path d="M17 331h6v8h-6ZM29 331h6v8h-6ZM41 331h6v8h-6ZM17 347h6v8h-6ZM29 347h6v8h-6ZM41 347h6v8h-6ZM17 363h6v8h-6ZM29 363h6v8h-6ZM41 363h6v8h-6ZM17 379h6v8h-6ZM29 379h6v8h-6ZM41 379h6v8h-6Z" fill="#E4E9E1" /><rect x="0" y="412" width="54" height="120" rx="3" fill="#C9D3C8" /><path d="M12 421h6v8h-6ZM24 421h6v8h-6ZM36 421h6v8h-6ZM12 437h6v8h-6ZM24 437h6v8h-6ZM36 437h6v8h-6ZM12 453h6v8h-6ZM24 453h6v8h-6ZM36 453h6v8h-6ZM12 469h6v8h-6ZM24 469h6v8h-6ZM36 469h6v8h-6ZM12 485h6v8h-6ZM24 485h6v8h-6ZM36 485h6v8h-6ZM12 501h6v8h-6ZM24 501h6v8h-6ZM36 501h6v8h-6ZM12 517h6v8h-6ZM24 517h6v8h-6ZM36 517h6v8h-6Z" fill="#E4E9E1" /><rect x="14" y="544" width="40" height="60" rx="3" fill="#C9D3C8" /><path d="M25 553h6v8h-6ZM37 553h6v8h-6ZM25 569h6v8h-6ZM37 569h6v8h-6ZM25 585h6v8h-6ZM37 585h6v8h-6Z" fill="#E4E9E1" /><rect x="336" y="200" width="54" height="104" rx="3" fill="#C9D3C8" /><path d="M348 209h6v8h-6ZM360 209h6v8h-6ZM372 209h6v8h-6ZM348 225h6v8h-6ZM360 225h6v8h-6ZM372 225h6v8h-6ZM348 241h6v8h-6ZM360 241h6v8h-6ZM372 241h6v8h-6ZM348 257h6v8h-6ZM360 257h6v8h-6ZM372 257h6v8h-6ZM348 273h6v8h-6ZM360 273h6v8h-6ZM372 273h6v8h-6ZM348 289h6v8h-6ZM360 289h6v8h-6ZM372 289h6v8h-6Z" fill="#E4E9E1" /><rect x="330" y="316" width="44" height="86" rx="3" fill="#C9D3C8" /><path d="M337 325h6v8h-6ZM349 325h6v8h-6ZM361 325h6v8h-6ZM337 341h6v8h-6ZM349 341h6v8h-6ZM361 341h6v8h-6ZM337 357h6v8h-6ZM349 357h6v8h-6ZM361 357h6v8h-6ZM337 373h6v8h-6ZM349 373h6v8h-6ZM361 373h6v8h-6ZM337 389h6v8h-6ZM349 389h6v8h-6ZM361 389h6v8h-6Z" fill="#E4E9E1" /><rect x="346" y="410" width="44" height="132" rx="3" fill="#C9D3C8" /><path d="M353 419h6v8h-6ZM365 419h6v8h-6ZM377 419h6v8h-6ZM353 435h6v8h-6ZM365 435h6v8h-6ZM377 435h6v8h-6ZM353 451h6v8h-6ZM365 451h6v8h-6ZM377 451h6v8h-6ZM353 467h6v8h-6ZM365 467h6v8h-6ZM377 467h6v8h-6ZM353 483h6v8h-6ZM365 483h6v8h-6ZM377 483h6v8h-6ZM353 499h6v8h-6ZM365 499h6v8h-6ZM377 499h6v8h-6ZM353 515h6v8h-6ZM365 515h6v8h-6ZM377 515h6v8h-6Z" fill="#E4E9E1" /><rect x="332" y="552" width="58" height="60" rx="3" fill="#C9D3C8" /><path d="M340 561h6v8h-6ZM352 561h6v8h-6ZM364 561h6v8h-6ZM376 561h6v8h-6ZM340 577h6v8h-6ZM352 577h6v8h-6ZM364 577h6v8h-6ZM376 577h6v8h-6ZM340 593h6v8h-6ZM352 593h6v8h-6ZM364 593h6v8h-6ZM376 593h6v8h-6Z" fill="#E4E9E1" /><ellipse cx="34" cy="174" rx="12.8" ry="4" fill="#D2E2CA" /><rect x="31.5" y="156" width="5" height="18" rx="2" fill="#9C8B73" /><circle cx="34" cy="150" r="15" fill="#A9CBA0" /><circle cx="29.1" cy="145.1" r="6.8" fill="#BCD8B3" /><ellipse cx="40" cy="662" rx="11" ry="4" fill="#D2E2CA" /><rect x="37.5" y="645.2" width="5" height="16.8" rx="2" fill="#9C8B73" /><circle cx="40" cy="640" r="13" fill="#A9CBA0" /><circle cx="35.7" cy="635.7" r="5.9" fill="#BCD8B3" /><ellipse cx="360" cy="652" rx="11" ry="4" fill="#D2E2CA" /><rect x="357.5" y="635.2" width="5" height="16.8" rx="2" fill="#9C8B73" /><circle cx="360" cy="630" r="13" fill="#A9CBA0" /><circle cx="355.7" cy="625.7" r="5.9" fill="#BCD8B3" />
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d={d} stroke="#9C8B73" strokeWidth="42" />
        <path d={d} stroke="#E2D3BA" strokeWidth="34" />
        <path d={d} stroke="#CDBB9E" strokeWidth="34" strokeDasharray="2.5 9" strokeLinecap="butt" />
        <path d={trail} stroke="var(--sage)" strokeWidth="5" strokeDasharray="1 13" />
      </g>
      {fog ? <rect width="390" height="1600" fill="var(--bg)" opacity=".38" /> : null}
    </svg>
  );
}

// Drifting clouds over a closed world (positions chosen so they sit beside the road, never on a stop).
export function FogClouds() {
  return (
    <svg className="ln-fog-svg" width="390" height="696" viewBox="0 0 390 696" aria-hidden="true">
      <g fill="#FFFFFF" opacity=".82">
        <ellipse cx="22" cy="268" rx="46" ry="16" /><ellipse cx="56" cy="258" rx="30" ry="14" />
        <ellipse cx="372" cy="372" rx="48" ry="16" /><ellipse cx="338" cy="364" rx="28" ry="13" />
        <ellipse cx="30" cy="500" rx="50" ry="17" /><ellipse cx="68" cy="510" rx="28" ry="12" />
        <ellipse cx="364" cy="214" rx="40" ry="14" />
        <ellipse cx="360" cy="566" rx="44" ry="15" />
      </g>
      <g fill="#FFFFFF" opacity=".42">
        <ellipse cx="200" cy="244" rx="40" ry="10" />
        <ellipse cx="196" cy="372" rx="44" ry="11" />
        <ellipse cx="204" cy="498" rx="40" ry="10" />
      </g>
    </svg>
  );
}
