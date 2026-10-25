# Data audit (October 2026)

All 784 rows of `data/nestle-brands.csv` were checked against current sources. Each chunk got a second, independent researcher, plus a final pass across chunks. A later web-search pass re-checked every row that had been removed only because it couldn't be found. The full row-by-row log is at the end.

**At a glance**

| | Before | After |
|---|---|---|
| Rows | 784 | 799 |
| Brands on the map | 381 | 499 |
| Rows marked "Status unconfirmed" | 35 | 0 |

- 115 products became brands; 14 brands became groups; 1 brand became a product
- 69 rows moved to a different parent; 85 ownership values corrected
- 43 rows removed (placeholders, non-brands, things with no evidence); 58 added (bundled rows split up, plus confirmed brands that were missing)
- 227 names cleaned (descriptions taken out of names, own spellings, "(Country)" qualifiers); 253 notes shortened or cleared

## What changed in the structure

- **New `type` column** (`category`, `group`, `brand`, `product`). The map used to guess the type from the row's depth, which is how Dreyer's and Drumstick ended up as "products" of Froneri. The type is now stated per row, and the loader warns if a row's type doesn't fit where it sits.
- **Groups can carry ownership.** Froneri (50/50 joint venture), European Pizza Group (44.5%), Lactalis Nestlé Produits Frais (40%), Grupo CRM (majority) and Los Portales (Cuba) are now groups of brands with their own status. On the map, the line to such a group is dashed like other part-owned lines. Its card shows the ownership and a note.
- **Ice Cream**: Froneri is a group holding 33 brands, including Dreyer's/Edy's, Drumstick, Outshine, Skinny Cow, Häagen-Dazs (US licence), Extrême, Maxibon, Mövenpick, Peters, Tip Top, the licensed Oreo/Cadbury/Milka/Lotus ice creams and the 2026 Food Union brands. "Nestlé in-house ice cream" is a group (not a brand) holding the Canada, Chile, Peru and Malaysia brands that are moving to Froneri. Its Canada sub-level was flattened into "(Canada)" names. The "Brazil" rows moved under Froneri, which has run Brazil since 2016. The category is tagged "half-owned", and its moving brands read "Moving to Froneri".
- **Other company-type rows became groups**: Wyeth Nutrition, Osem-Nestlé (Israel; Osem itself is now a brand inside), Grupo CRM (Kopenhagen, Brasil Cacau), the vitamins being sold, Middle East waters, and in Formerly Nestlé the US confectionery business, US and Canada waters, Nestlé Skin Health and Dairy Partners Americas.
- **Statuses resolved**: every "Uncertain" row was either confirmed with a source (33) or removed (2). Former brands that weren't sold now sit in "Discontinued (not sold)". Waters brands that were already sold (Brazil, Chile, Germany, Italy, China, Philippines) moved to Formerly Nestlé.
- **Copy**: research remarks ("Listed range; no dedicated URL", "not verified", "Example product page"), deal values and acronyms (JV, CPW, VMS, DPA, GLP-1) were removed from visitor-facing text.

## Items I'm unsure about

### Ownership calls that could go either way
- **Froneri, 50%**: Froneri says it is owned in equal shares, but Nestlé's accounts show about 48% economically (voting is 50%). Kept at 50/50.
- **Nestlé brands that Froneri makes** (Rowntree's, Drumstick, Maxibon, Mega, LaFrutta, Nestlé Tradicional, Helados Nestlé): set to the joint venture's 50%, not "Licensed". "Licensed" is kept for third-party names like Häagen-Dazs and Oreo.
- **Helados Nestlé (Mexico)**: Froneri took a controlling stake in Grupo Herdez's Nestlé-licensed ice cream business (31 Aug 2026). The size of the stake isn't public.
- **Malaysia ice cream** (Mat Kool, La Cremeria, Drumstick (Malaysia)): shown as "Moving to Froneri", but Nestlé Malaysia has only said it will *explore* a sale. **D'Onofrio (Peru)** is named in the transfer list, but there is no date.
- **Isbjørn Is (Norway)**: Norway was in the 2025 Food Union announcement, but the June 2026 completion note doesn't name it.
- **Blue Bottle capsules**: Blue Bottle was sold in 2026 and Nestlé kept the capsules. Shown as "Licensed"; the terms aren't public.
- **Shreddies / Shredded Wheat**: set to the cereal joint venture's 50% (Cereal Partners has owned the UK business since 1990). One Wikipedia footnote says Post owns Shreddies.
- **Clusters**: kept at the joint venture's 50%. It might be a General Mills trademark, which would make it "Licensed".
- **Hirz (Switzerland)**: moved into the Lactalis–Nestlé chilled dairy group (Nestlé 40%). Its site is published by the Swiss Lactalis Nestlé company, but Nestlé's accounts only list the French one.
- **Waters stakes**: Al Manhal (90%), La Vie (65%), and Eco de los Andes and Glaciar (50.9%) are shown as "Majority". It isn't clear whether they are part of the waters joint venture deal.
- **Ovaltine (US)**: Nestlé owns the US trademark, but Ovaltine is missing from Nestlé USA's current brand list, so it may barely be sold.
- **Waggin' Train**: moved to Formerly Nestlé because its site says it now belongs to Simply Protein for Pets. A Kroger listing still calls it "Purina Waggin' Train".
- **Special.T**: marked "Discontinued" while its capsules are still on sale until about February 2027.
- **Tails.com**: now "Owned" (fully since 2023), based on the web-search pass. **Orgain**: Nestlé owns about 91% (2025).

### Status calls made on thin evidence
- **Discontinued based on third-party sources** (no Nestlé notice): Sweet Earth, Castor & Pollux, Mighty Dog, Purina Muse, Tender Vittles, Canyon Creek Ranch, Bona (Finland), Belsol (China), Crucial, Sollys (Brazil), Allen's Sourz, Garden Gourmet frozen pizza, Nescafé Partners' Blend (UK).
- **Sale inferred but not confirmed**: Dar Natury (Poland), Nestlé Selda (Portugal), Waterman (China) and Montclair (Canada) were placed with the business sales they most likely went with (Nestlé Waters Direct to Eden Springs; China waters to Tsingtao; North America waters in 2021).
- **Country Fresh (South Africa)**: the only evidence is a Froneri staff profile.
- **Nature's Heart (Latin America)**: now "Majority" (it came with Nestlé's Terrafertil stake). Its Brazil page lists no products, so it may be winding down.
- **KitKat Chocolatory**: kept because shops remain in Japan; the Brazil shops have closed.
- **Nestlé Barista** (plant-based café milks, Asia): the only source is the 2023 launch.
- **Calistoga**: went with the 2021 North America waters sale, and the buyer later dropped it.
- **Pejo**: moved to Formerly Nestlé ("Sold in 2014"), based on Pejo's own history page.

### Removed because no evidence was found (can be restored with a source)
Mountain Blend, Alaçam, Frische Brise, Charmoise, Water Line (South Korea), Springs (Middle East), Aqua Spring (Greece), Deep Spring, Asamim, RWL, Gerber Mindful Parenting Collection.

Also removed:
- **Not brands**: Ristretto (a coffee style), Pro Plan Vet Direct (a web shop), Service Dogs for Veterans (a campaign), Grown Respectfully, Custom Innovation Group, Purina Snacks (Brazil), Nestlé Snack-Size, Felix Pick 'n' Mix, the "US private-label supplements business", Nescafé Malaysia (a country site).
- **Wrongly listed as Nestlé's**: Aqua Minerale (PepsiCo), Arctic (Kofola), Trophic (Prodiet), Zvečevo, Meow Mix and Alley Cat (sold by Ralston before Nestlé bought it).
- **Placeholder rows**: replaced by real brands, or dropped where no brand could be named (China and Thailand ice cream).

### Not added (possible additions if you want them)
- **Formerly Nestlé**: PowerBar (sold 2014), Jenny Craig (2013), Freshly (closed 2023), Vita Brits (2025), Goobers, Chunky and Nips (sold to Ferrero in 2018), Crosse & Blackwell (UK), Proactiv (2016), Peñaclara (Spain).
- **Current**:
  - Regional sweets and biscuits: McKay biscuits (Chile), Balaton (Hungary), Czech sweets (Lentilky, Margot, Hašlerky…), more Osem-Nestlé brands (Popco, Bonjour…), Peru and Ecuador biscuits.
  - Other regional: Mivina noodles (Ukraine), Chaotianxiang (China seasonings).
  - Ice cream: more Froneri brands (Nobbly Bobbly, Manhattan, Familia, Premier Is…).
  - Health and baby: Go Healthy (New Zealand), Nestlé Vital, BabyNes (China), more US medical-nutrition brands.

### Research limits
- The first audit pass ran out of web searches partway through. It fell back to loading official pages directly, which is why some removals were wrong (International Roast, Capri, Bonna, Kop Koffee and Nesvita (Thailand) have been restored). Every removal of that kind was then re-checked with web search. One verifier in that pass failed on a network error, so I checked its five items myself.
- purina.com, perrier.com, sanpellegrino.com, osem-nestle.co.il and a few other sites block automated loading. Links there that couldn't be opened are marked `url_verified = no`.
- Logos were added afterwards for 250 more brands (462 of 499 now have one). Sources are in `scripts/logos/manifest-c.json`.

## Full change log

<details><summary><b>Coffee & Beverages</b> (79 rows)</summary>

- `2` Coffee & Beverages: note cleared
- `4` Nescafé Classic: note cleared; link updated
- `5` Nescafé Gold: renamed from “Nescafé Gold (incl. Gold Mixes: Cappuccino, Choco Mocha, Caramel Latte; US Gold Espresso)”
- `15` Nescafé Gold Blend (UK): renamed from “Nescafé Gold Blend and Blend 37 (UK)”; moved to Nescafé Gold; note cleared; link updated
- `17` Nescafé Gold Blend (Japan): renamed from “Nescafé Japan (incl. Gold Blend)”; moved to Nescafé Gold
- `6` Nescafé Azera: note cleared; link updated
- `7` Nescafé 3in1: renamed from “Nescafé 3 in 1”; note cleared; link updated
- `9` Nescafé ready-to-drink: renamed from “Nescafé ready-to-drink (Smoovlatté, Shakissimo)”; note cleared; link updated
- `12` Nescafé Ice Roast (US): note cleared
- `16` Nescafé Blend 43 (Australia/NZ): note cleared; link updated
- `19` Nescafé Sunrise (India): renamed from “Nescafé Sunrise (India, coffee-chicory)”; link updated
- `20` Nescafé Ricoffy (South Africa): link updated
- `21` Nescafé Dolca (Argentina/Chile): renamed from “Dolca (Chile/Argentina)”; note cleared; link updated
- `22` Roastelier by Nescafé: renamed from “Roastelier by Nescafé (foodservice, on-site roasting)”; note: “Foodservice on-site roasting system.”
- `89` Nescafé Kirma (Peru): renamed from “Kirma (Peru)”; brand → product; moved to Nescafé; link updated
- `785` **added** product: Nescafé Excella (Japan) (Owned) in Nescafé
- `786` **added** product: Nescafé Farmers Origins (Owned) in Nescafé
- `791` **added** product: Nescafé Tradición (Owned) in Nescafé
- `24` Dolce Gusto Absolute Origin: renamed from “Dolce Gusto ranges (Black, White, Plant-based, Absolute Origin, Decaf)”; note cleared
- `25` Dolce Gusto NEO: note cleared
- `27` Nespresso Original: renamed from “Nespresso Original (incl. Lattissima machines)”; note cleared; link updated
- `28` Nespresso Vertuo: note cleared; link updated
- `29` Nespresso Professional: note cleared; link updated
- `30` Blue Bottle capsules: renamed from “Blue Bottle capsules (Nespresso channel)”; Uncertain → Licensed; note: “Blue Bottle was sold in 2026; Nestlé still sells these capsules.”; link updated
- `31` Starbucks Coffee At Home: note: “Permanent licence from Starbucks since 2018.”
- `33` Starbucks Ground: renamed from “Starbucks Ground (Roast & Ground)”
- `35` Starbucks Premium Instant: renamed from “Starbucks Instant / Premium Instant”
- `37` Starbucks Origami: renamed from “Starbucks Origami (pour-over)”; note cleared
- `39` Starbucks Coffee Craft: renamed from “Starbucks Coffee Craft concentrate”
- `43` Starbucks by Nespresso: renamed from “Starbucks by Nespresso (Original and Vertuo)”; note cleared; link updated
- `44` Starbucks by Nescafé Dolce Gusto: note cleared; link updated
- `45` Starbucks ready-to-drink: renamed from “Starbucks ready-to-drink (Doubleshot, Frappuccino)”; Uncertain → Licensed; note: “Nestlé sells it only in parts of Asia, Oceania and Latin America.”
- `46` We Proudly Serve Starbucks: renamed from “We Proudly Serve Starbucks (foodservice)”; note: “Foodservice line.”
- `47` Seattle's Best Coffee: note: “Bought from Starbucks in 2022.”
- `48` Seattle's Best Coffee foodservice: note cleared
- `58` Coffee mate foodservice: renamed from “Coffee mate foodservice (liquid, powder, concentrate, sugar-free, plant-based)”; note cleared
- `57` natural bliss: product → brand; moved to Coffee & Beverages; note cleared
- `59` Brite (Japan): renamed from “Brite (Japan creamer)”
- `62` Milo (Malaysia): renamed from “Milo Malaysia”
- `63` Milo (Australia): renamed from “Milo Australia”
- `64` Milo (Japan): renamed from “Milo Japan”
- `65` Milo (Central & West Africa): renamed from “Milo Central & West Africa”
- `66` Milo foodservice: note cleared
- `67` Nestea: note: “Made and sold by licensed partners in many markets.”
- `68` Nestea (Spain): renamed from “Nestea Spain/Andorra/Gibraltar (made by Damm)”; note: “Made by Damm under licence since 2025.”
- `69` Nestea (Canada): renamed from “Nestea Canada (KDP)”; note: “Made by Keurig Dr Pepper under licence since 2025.”; link updated
- `71` Nestea foodservice: note cleared
- `72` Abuelita: renamed from “Abuelita (Mexican-style chocolate)”
- `73` Carlos V: renamed from “Carlos V (chocolate)”
- `74` GoodHost (Canada): renamed from “GoodHost (Canada iced tea)”
- `76` yfood: renamed from “yfood (meal-replacement drinks)”; note: “Fully owned since July 2026.”; link updated
- `77` Special.T: renamed from “Special.T (tea capsules)”; Transitioning → Discontinued; note: “Being phased out; capsules on sale until about February 2027.”
- `78` Ovaltine (US): renamed from “Ovaltine (US only)”; Licensed → Owned; note: “Nestlé owns the brand in the US only.”; link updated
- `79` Regional coffee brands: note cleared
- `80` Ricoré (France): renamed from “Ricoré (France, chicory-coffee)”; link updated
- `81` Sical (Portugal): link updated
- `82` Zoégas (Sweden): link updated
- `83` Bonka (Spain): link updated
- `84` Santa Cristina (Spain): note: “Sold mainly to cafés and restaurants.”; link updated
- `85` Buondi (Portugal): link updated
- `86` Christina (Portugal): note: “Sold mainly to cafés and restaurants.”; link updated
- `87` Loumidis Papagalos (Greece): renamed from “Loumidis (Greece)”; link updated
- `88` Ecco (Peru): renamed from “Ecco (Chile/Peru)”; link updated
- `90` Águila (Uruguay): renamed from “Aguila (Uruguay)”; link updated
- `91` El Chaná (Uruguay): link updated
- `92` International Roast (Australia/NZ): renamed from “International Roast”; link updated
- `96` Tofa (Portugal): renamed from “Tofa”; link updated
- `105` Caro (Germany): renamed from “Caro / Pero (cereal coffee)”; moved to Regional coffee brands; link updated
- `787` **added** brand: Linde's (Germany) (Owned) in Regional coffee brands
- `788` **added** brand: Incarom (Switzerland) (Owned) in Regional coffee brands
- `789` **added** brand: Eko (Spain) (Owned) in Regional coffee brands
- `790` **added** brand: Bracafé (Uruguay) (Owned) in Regional coffee brands
- `97` Regional chocolate drinks: renamed from “Regional malt, chocolate and dairy drinks”
- `99` Ricacao (Ecuador): link updated
- `102` Nesvita (Thailand): renamed from “Nesvita (Pakistan/Thailand)”; link updated
- `104` Romanette (Switzerland): moved to Coffee & Beverages; link updated
- `18` **removed**: Nescafé Malaysia
- `93` **removed**: Mountain Blend
- `95` **removed**: Ristretto

</details>

<details><summary><b>Waters & Premium Beverages</b> (51 rows)</summary>

- `107` Perrier: renamed from “Perrier (Source Perrier S.A.)”; note cleared
- `108` Perrier Original: renamed from “Perrier Original sparkling mineral water”
- `109` Perrier flavored sparkling waters: note cleared
- `110` Perrier Energize: renamed from “Perrier Energize (caffeinated, yerba mate)”; note cleared
- `111` Perrier Fines Bulles (France): note cleared; link updated
- `112` Maison Perrier: Uncertain → Transitioning; note cleared; link updated
- `113` S.Pellegrino: renamed from “S.Pellegrino (Sanpellegrino S.p.A.)”; note cleared
- `115` S.Pellegrino Essenza: note cleared
- `116` Sanpellegrino Italian Sparkling Drinks: renamed from “Sanpellegrino Italian Sparkling Drinks (Aranciata, Limonata, Pompelmo, etc.)”; note cleared
- `120` Acqua Panna: product → brand; moved to Waters & Premium Beverages; note cleared
- `121` Levissima: product → brand; moved to Waters & Premium Beverages
- `123` Contrex: product → brand; moved to Waters & Premium Beverages; note cleared; link updated
- `124` Hépar: product → brand; moved to Waters & Premium Beverages
- `125` Nestlé Pure Life: renamed from “Nestlé Pure Life (outside US/Canada)”; note: “The US and Canada business was sold in 2021.”; link updated
- `126` Nestlé Pure Life (Pakistan): renamed from “Nestlé Pure Life Pakistan (Nestlé Pakistan Ltd)”; Majority → Transitioning; note: “Nestlé owns 62% of the Pakistan company.”
- `792` **added** product: Nestlé Pureza Vital (Argentina) (Majority) in Nestlé Pure Life. Note: Nestlé owns just over half.
- `127` Essentia: renamed from “Essentia (US alkaline water)”; note: “Bought by Nestlé in 2021.”
- `128` Middle East waters: renamed from “Middle East (JV with Al Muhaidib)”; brand → group; JV (stake undisclosed) → Group; note cleared; link updated
- `129` Al Manhal: renamed from “Al Manhal (Saudi Arabia)”; product → brand; JV (stake undisclosed) → Majority; note: “Nestlé owns 90% of the Saudi company.”
- `131` Ghadeer (Jordan): product → brand; JV (stake undisclosed) → Transitioning
- `132` Baraka (Egypt): product → brand; JV (stake undisclosed) → Transitioning
- `133` Sohat (Lebanon): product → brand; JV (stake undisclosed) → Transitioning; link updated
- `138` Henniez: note: “Bought by Nestlé in 2007.”
- `141` Erikli: Majority → Transitioning; note cleared
- `144` Nałęczowianka: note cleared; link updated
- `153` Valvert: note cleared; link updated
- `156` Aquarel: note cleared
- `157` Viladrau: note cleared; link updated
- `161` Korpi: note cleared; link updated
- `171` Eco de los Andes: Transitioning → Majority; note: “Nestlé owns just over half.”; link updated
- `172` Glaciar: Transitioning → Majority; note: “Nestlé owns just over half.”
- `174` Santa María: note cleared
- `177` Los Portales (Cuba): renamed from “Cuba waters”; Group → JV (stake undisclosed)
- `178` Ciego Montero: note cleared
- `181` La Vie (Vietnam): Transitioning → Majority; note: “Nestlé owns 65%.”; link updated
- `186` Minéré (Thailand): note cleared
- `130` **removed**: Springs
- `142` **removed**: Alaçam
- `145` **removed**: Aqua Mineral
- `146` **removed**: Arctic
- `148` **removed**: Germany waters
- `150` **removed**: Frische Brise
- `151` **removed**: Blaue Quellen
- `154` **removed**: Charmoise
- `158` **removed**: Portugal waters
- `162` **removed**: Aqua Spring
- `163` **removed**: Italy waters
- `169` **removed**: Vale do Sol
- `175` **removed**: Chile waters
- `179` **removed**: Los Portales
- `183` **removed**: Water Line (South Korea)

</details>

<details><summary><b>Confectionery & Baking</b> (42 rows)</summary>

- `187` Confectionery & Baking: note: “US candy brands were sold to Ferrero in 2018; Nestlé kept its US baking brands.”
- `188` KitKat: note: “Hershey makes it in the US under licence.”
- `189` KitKat (Japan): renamed from “KitKat Japan (regional flavours)”
- `190` KitKat (Canada): renamed from “KitKat Canada”
- `191` KitKat (Switzerland): renamed from “KitKat Switzerland”
- `192` KitKat Chocolatory: renamed from “KitKat Chocolatory (boutique retail)”; note: “Shops remain in Japan; the Brazil shops closed in 2024.”
- `193` Aero: note cleared
- `197` Crunch: renamed from “Crunch (outside US)”; note: “US rights sold to Ferrero in 2018.”
- `200` Milkybar: note cleared
- `201` Galak: renamed from “Galak (white chocolate, continental Europe/Latin America)”; note cleared
- `205` Rolo: renamed from “Rolo (outside US)”; note: “Hershey makes it in the US under licence.”
- `207` Rowntree's Fruit Pastilles: link updated
- `208` Rowntree's Randoms: link updated
- `209` Rowntree's Jelly Tots: link updated
- `210` Smarties: renamed from “Smarties (outside US)”; note: “Unrelated to the US candy also called Smarties.”
- `215` Turtles (Canada): note: “Unrelated to the US Turtles candy.”
- `220` Drumstick Bites (Canada): note: “Shelf-stable snack, separate from Drumstick ice cream.”
- `221` Bar-One: renamed from “Bar-One (India, South Africa)”
- `223` Nestlé Classic: renamed from “Nestlé Classic (Brazil, Latin America, India)”; note cleared
- `225` Frigor: renamed from “Frigor (Cailler range)”; link updated
- `226` Perugina (Italy): note cleared
- `228` Garoto (Brazil): note cleared
- `231` Baton: link updated
- `232` Garoto Chocolateria: renamed from “Garoto Chocolateria (professional)”; note: “Foodservice line.”
- `233` Grupo CRM (Brazil): renamed from “Kopenhagen group (Brazil)”; brand → group; note: “Nestlé bought a majority stake in 2024.”
- `234` Kopenhagen: product → brand
- `235` Brasil Cacau: product → brand; link updated
- `236` Kop Koffee: product → brand
- `237` Hsu Fu Chi (China): note: “Fully owned since 2025.”; link updated
- `238` Allen's (Australia): renamed from “Allen's (Australia lollies)”; note cleared
- `239` Minties: link updated
- `241` Red Ripperz: link updated
- `242` Cheekies: link updated
- `244` Party Mix: link updated
- `807` **added** product: Killer Pythons (Owned) in Allen's (Australia)
- `808` **added** product: Snakes Alive (Owned) in Allen's (Australia)
- `247` Nestlé Toll House: renamed from “Nestlé Toll House (US baking)”
- `248` Toll House Morsels: renamed from “Toll House morsels, refrigerated cookie dough, baking bars”; link updated
- `805` **added** product: Toll House Refrigerated Cookie Dough (Owned) in Nestlé Toll House
- `250` Libby's: renamed from “Libby's (100% Pure Pumpkin)”; note: “Pumpkin products only; other Libby's foods belong to other companies.”
- `251` Libby's foodservice: note cleared
- `219` **removed**: Nestlé Snack-Size (Canada)

</details>

<details><summary><b>Ice Cream (via Froneri)</b> (51 rows)</summary>

- `252` Ice Cream (via Froneri): note: “Held through Nestlé's 50% stake in Froneri. Nestlé's last own ice cream units move to Froneri by early 2027.”
- `253` Froneri: renamed from “Froneri International”; brand → group; note: “Joint venture with PAI Partners since 2016.”
- `254` Dreyer's / Edy's (US): product → brand; note cleared; link updated
- `255` Drumstick: renamed from “Drumstick (US)”; product → brand; link updated
- `256` Outshine: product → brand; link updated
- `257` Skinny Cow: product → brand; Uncertain → JV 50%; note cleared; link updated
- `258` Häagen-Dazs (US): renamed from “Häagen-Dazs (US licence)”; product → brand; note: “General Mills brand.”; link updated
- `259` Extrême: product → brand; link updated
- `260` Pirulo: product → brand; link updated
- `261` Maxibon: product → brand; link updated
- `262` Nuii: product → brand; link updated
- `263` Mövenpick ice cream: renamed from “Mövenpick ice cream (Switzerland)”; product → brand; link updated
- `264` Kaktus (Poland): product → brand; link updated
- `265` Peters (Australia): product → brand; link updated
- `266` Tip Top (New Zealand): product → brand; link updated
- `267` Kelly's of Cornwall: product → brand; link updated
- `268` Fab: renamed from “FAB”; product → brand; link updated
- `269` Kāpiti: product → brand; link updated
- `270` Connoisseur: product → brand; link updated
- `271` Country Fresh (South Africa): product → brand; link updated
- `272` Rowntree's ice lollies: product → brand; Licensed → JV 50%; note: “Nestlé brand, made by Froneri under licence.”; link updated
- `273` Oreo ice cream: renamed from “Licensed partner brands (Oreo, Lotus Biscoff, Cadbury, Milka)”; product → brand; note: “Mondelēz brand.”; link updated
- `274` Crufi (Uruguay): renamed from “CRUFI (Uruguay)”; product → brand; note: “Joined Froneri in 2024.”; link updated
- `275` Premia (Baltics): renamed from “Food Union ice cream”; product → brand; Uncertain → JV 50%; note: “Joined Froneri in 2026.”; link updated
- `290` LaFrutta: renamed from “La Frutta”; product → brand; moved to Froneri; Uncertain → JV 50%; link updated
- `291` Mega: renamed from “Crocante, Mega, Galak, Tradicional (ice cream)”; product → brand; moved to Froneri; Uncertain → JV 50%; link updated
- `679` Frigor (Argentina): moved to Froneri; Uncertain → JV 50%; note cleared; link updated
- `794` **added** brand: Cadbury ice cream (Licensed) in Froneri. Note: Mondelēz brand.
- `795` **added** brand: Milka ice cream (Licensed) in Froneri. Note: Mondelēz brand.
- `796` **added** brand: Lotus Biscoff ice cream (Licensed) in Froneri. Note: Lotus Bakeries brand.
- `797` **added** brand: Isbjørn Is (Norway) (JV 50%) in Froneri. Note: Joined Froneri in 2026.
- `798` **added** brand: Hjem-IS (Denmark) (JV 50%) in Froneri. Note: Joined Froneri in 2026.
- `802` **added** brand: Helados Nestlé (Mexico) (JV 50%) in Froneri. Note: Nestlé brand; Froneri took over the Mexican business in 2026.
- `803` **added** brand: Nestlé Tradicional (Brazil) (JV 50%) in Froneri
- `804` **added** brand: Frosty Paws (JV 50%) in Froneri
- `276` Nestlé in-house ice cream: brand → group; note: “In stages through early 2027.”
- `278` Drumstick (Canada): product → brand; moved to Nestlé in-house ice cream
- `279` Parlour (Canada): renamed from “Parlour”; product → brand; moved to Nestlé in-house ice cream
- `280` Real Dairy (Canada): renamed from “Real Dairy”; product → brand; moved to Nestlé in-house ice cream
- `281` iÖGO frozen yogurt (Canada): renamed from “iÖGO frozen yogurt”; product → brand; moved to Nestlé in-house ice cream; note: “Lactalis Canada brand.”
- `282` Häagen-Dazs (Canada): product → brand; moved to Nestlé in-house ice cream
- `283` Del Monte (Canada): renamed from “Del Monte (Canada frozen)”; product → brand; moved to Nestlé in-house ice cream
- `284` Baskin Robbins at Home (Canada): renamed from “Baskin Robbins at Home”; product → brand; moved to Nestlé in-house ice cream
- `286` Savory (Chile): product → brand; link updated
- `287` D'Onofrio ice cream (Peru): product → brand; Uncertain → Transitioning; note: “Expected to move to Froneri; no date announced.”
- `288` Mat Kool (Malaysia): renamed from “China, Malaysia and Thailand ice cream units”; product → brand; note cleared; link updated
- `799` **added** brand: La Cremeria (Malaysia) (Transitioning) in Nestlé in-house ice cream
- `800` **added** brand: Drumstick (Malaysia) (Transitioning) in Nestlé in-house ice cream
- `277` **removed**: Nestlé Canada ice cream
- `285` **removed**: Confectionery frozen desserts (KitKat, Coffee Crisp, etc.)
- `289` **removed**: Nestlé Brasil sorvetes

</details>

<details><summary><b>Frozen & Prepared Foods</b> (12 rows)</summary>

- `292` Frozen & Prepared Foods: note: “Nestlé said in 2026 it will keep its US frozen business.”
- `294` Stouffer's Professional: note cleared
- `298` Vital Pursuit: note: “Launched in 2024 for people taking weight-loss medicines.”
- `302` California Pizza Kitchen frozen: note: “Licensed from the California Pizza Kitchen restaurant chain.”
- `304` European Pizza Group: renamed from “European Pizza Group (JV with PAI Partners)”; brand → group; note: “Joint venture with PAI Partners; Nestlé owns 44.5%.”; link updated
- `305` Wagner: product → brand; link updated
- `306` Buitoni frozen pizza (Europe): product → brand; link updated
- `308` Garden Gourmet: renamed from “Garden Gourmet (plant-based)”; link updated
- `309` Vuna (vegan tuna): note cleared; link updated
- `310` Nature's Heart (Latin America): renamed from “Nature's Heart (plant-based, Brazil/Mexico)”; Owned → Majority; note: “Majority stake since 2018.”
- `311` Hälsans Kök (Nordics): renamed from “Hälsans Kök (Nordics plant-based)”; link updated
- `801` **added** brand: Mings (Licensed) in Frozen & Prepared Foods. Note: Chef Ming Tsai's brand.

</details>

<details><summary><b>Culinary & Dairy</b> (14 rows)</summary>

- `313` Maggi: note cleared
- `325` Maggi sauces and cooking aids (India): note cleared
- `326` Maggi Magic Sarap (Philippines): link updated
- `328` Thomy (Germany/Switzerland): note cleared
- `330` Buitoni: renamed from “Buitoni (pasta/sauces outside US and frozen pizza JV)”; note: “No longer Nestlé's in the US; its frozen pizza is made by the European Pizza Group.”
- `331` Totole (China): renamed from “Totole (China bouillon)”; Majority → Owned; note cleared; link updated
- `332` Haoji (China): renamed from “Haoji (Sichuan seasonings)”; note: “Nestlé owns 80%.”; link updated
- `335` Carnation: renamed from “Carnation (evaporated milk)”
- `338` La Lechera: renamed from “La Lechera (sweetened condensed milk)”; note cleared
- `341` Media Crema: renamed from “Media Crema (table cream)”
- `343` Nestlé All Purpose Cream (Philippines): link updated
- `344` Molico (Brazil): note: “Chilled versions were sold to Lactalis in 2023.”
- `347` Nestlé Everyday (India): renamed from “Nestlé Everyday (India dairy whitener)”
- `348` Nestlé a+ (India): renamed from “Nestlé a+ (India dairy)”

</details>

<details><summary><b>Breakfast Cereals via Cereal Partners Worldwide</b> (20 rows)</summary>

- `349` Breakfast Cereals via Cereal Partners Worldwide: note: “Joint venture with General Mills, each owning 50%; sold outside the US and Canada.”
- `350` Cheerios: note: “General Mills brand.”
- `353` Strawberry Minis: renamed from “Curiously Strawberry”
- `357` Shreddies: Licensed → JV 50%; note: “Post owns the brand in North America.”
- `358` Shredded Wheat: Licensed → JV 50%; note: “Post owns the brand in North America.”
- `362` Go Free: renamed from “Go Free (gluten-free)”
- `369` Nestlé Gold: renamed from “Nestlé GOLD Crunchy Corn & Oat Flakes (India)”
- `371` Clusters: link updated
- `372` Honey Stars: link updated
- `373` Milo Cereal: renamed from “Milo cereals”; link updated
- `374` Brazil: renamed from “Brazil cereals”; brand → group; Uncertain → Group; note cleared; link updated
- `375` Nescau Cereal: product → brand; Uncertain → JV 50%
- `377` Moça Flakes: product → brand; Uncertain → JV 50%
- `378` Negresco Cereal: product → brand; Uncertain → JV 50%
- `379` Nesfit: product → brand; Uncertain → JV 50%; note cleared
- `380` Snow Flakes: product → brand; Uncertain → JV 50%
- `382` Uncle Tobys (Australia): renamed from “Uncle Tobys cereals (Australia/NZ)”; note: “Uncle Tobys snacks are fully owned by Nestlé.”; link updated
- `385` Uncle Tobys Fruity Bites: link updated
- `806` **added** product: Uncle Tobys Oats (JV 50%) in Uncle Tobys (Australia)
- `714` Estrelitas (Portugal): moved to Breakfast Cereals via Cereal Partners Worldwide; Owned → JV 50%; link updated

</details>

<details><summary><b>Purina PetCare</b> (66 rows)</summary>

- `386` Purina PetCare: note cleared
- `390` Pro Plan Puppy: renamed from “Pro Plan Puppy / Development”
- `391` Pro Plan Complete Essentials: note cleared
- `392` Pro Plan AdvantEDGE: note cleared
- `393` Pro Plan Sport: renamed from “Pro Plan Sport (Performance 30/20)”; note cleared; link updated
- `395` Pro Plan Wet: link updated
- `397` Pro Plan Veterinary Diets for Dogs: renamed from “Pro Plan Vet dog diets”
- `398` Pro Plan Veterinary Diets for Cats: renamed from “Pro Plan Vet cat diets”
- `405` Skin Care: renamed from “Skin Care (dog)”
- `406` Multi Care: renamed from “Multi Care (dog)”
- `411` Purina ONE +Plus: note cleared
- `412` Purina ONE Dog (Europe): renamed from “Purina ONE Dog / Mini (EU)”
- `413` Purina Dog Chow: note cleared
- `414` Dog Chow Complete: note cleared
- `415` Dog Chow High Protein: note cleared
- `419` Purina Cat Chow: note cleared
- `424` Cat Chow Gentle: note cleared
- `432` Fancy Feast Gems: note cleared
- `433` Fancy Feast Gravy Lovers: note cleared
- `434` Fancy Feast Broths: note cleared
- `435` Fancy Feast Classic Paté: note cleared
- `436` Fancy Feast Timeless Favorites: note cleared
- `439` Fancy Feast Chef's Cuts: renamed from “Fancy Feast Chef's Cuts (treats)”
- `441` Fancy Feast Medleys: Uncertain → Owned; note cleared; link updated
- `450` Friskies Surfin' & Turfin' Favorites: renamed from “Friskies Surfin' & Turfin'”
- `451` Friskies Dog (Europe): link updated
- `455` Tidy Cats Breeze: renamed from “Breeze litter box system”
- `456` Tidy Cats Lightweight: note cleared
- `464` DentaLife: note cleared
- `465` Petivity: renamed from “Petivity (smart litter-box monitor)”; link updated
- `466` Merrick: renamed from “Merrick Pet Care”; note: “Acquired in 2015.”
- `468` Merrick Backcountry: renamed from “Merrick dry lines (Backcountry, Grain Free, Lil' Plates, Limited Ingredient Diet, Kitchen Comforts, Fresh Selects)”; link updated
- `469` Merrick Fresh Selects: renamed from “Merrick Fresh-Frozen”; link updated
- `809` **added** product: Merrick Grain Free (Owned) in Merrick Dog
- `810` **added** product: Merrick Lil' Plates (Owned) in Merrick Dog
- `811` **added** product: Merrick Limited Ingredient Diet (Owned) in Merrick Dog
- `812` **added** product: Merrick Kitchen Comforts (Owned) in Merrick Dog
- `472` Merrick Purrfect Bistro: renamed from “Merrick Purrfect Bistro (cat)”
- `475` Zuke's: note: “Acquired in 2014.”
- `484` Lily's Kitchen: renamed from “Lily's Kitchen (UK)”; note: “Acquired in 2020.”
- `485` Lily's Kitchen Dog Food: renamed from “Lily's Kitchen dog ranges (Fresh, Wet, Dry, Treats, Dental Chews)”; link updated
- `486` Lily's Kitchen Cat Food: renamed from “Lily's Kitchen cat ranges (Wet, Dry, Treats)”; link updated
- `487` Tails.com (UK): Majority → Owned; note: “Fully owned since 2023.”
- `488` Petfinder: note: “Acquired in 2013.”
- `496` Europe: renamed from “Europe / UK regional”
- `503` Gourmet: note cleared
- `506` Gourmet Mon Petit Intense: renamed from “Gourmet Mon Petit (Intense)”
- `509` Gourmet Revelations: note cleared
- `497` Felix: moved to Purina PetCare
- `498` Felix As Good As It Looks Doubly Delicious: renamed from “Felix As Good As It Looks (Doubly Delicious)”
- `501` Felix Snacks: renamed from “Felix Snacks (Party Mix, Play Tubes, Crispies)”
- `507` Monpetit (Japan): product → brand; moved to Purina PetCare
- `517` Australia: renamed from “Australia regional”
- `520` Totalcare: renamed from “Total Care”
- `522` Argentina: renamed from “Argentina / Latin America regional”
- `526` Bonelo: renamed from “Bonelo (treats)”
- `527` Brazil: renamed from “Brazil regional”
- `529` Doguitos: link updated
- `530` Gatsy: link updated
- `531` Kanina: link updated
- `399` **removed**: Pro Plan Vet Direct (DTC store)
- `417` **removed**: Service Dogs for Veterans (program)
- `490` **removed**: Legacy US brands (status unconfirmed)
- `502` **removed**: Felix Pick 'n' Mix (UK direct)
- `511` **removed**: Beyond (EU)
- `532` **removed**: Purina Snacks (Brazil)

</details>

<details><summary><b>Nutrition (infant and child)</b> (60 rows)</summary>

- `100` Dancow (Indonesia): moved to Nutrition (infant and child); link updated
- `534` Gerber: note: “Owned since 2007.”
- `536` Gerber 1st, 2nd and 3rd Foods: renamed from “Gerber 1st Foods / 2nd Foods (purees)”; link updated
- `538` Gerber Puffs: renamed from “Gerber snack and food lines (Lil' Crunchies, Puffs, Yogurt Melts, Lil' Bits, Organic, Natural)”; note cleared; link updated
- `814` **added** product: Gerber Lil' Crunchies (Owned) in Gerber
- `815` **added** product: Gerber Yogurt Melts (Owned) in Gerber
- `816` **added** product: Gerber Organic (Owned) in Gerber
- `540` NAN: note cleared; link updated
- `541` NAN Optipro: link updated
- `542` NAN Infinipro: renamed from “NAN Infinipro HA”; link updated
- `543` NAN Sin Lactosa: renamed from “NAN AL 110”; link updated
- `544` NAN Sensitive: link updated
- `545` NAN Soya: renamed from “NanSoy”; link updated
- `546` Nankid: link updated
- `547` PreNAN: renamed from “PreNan (preterm)”; link updated
- `548` FM 85: renamed from “FM 85 (human milk fortifier)”; link updated
- `549` Nanlac (Brazil): link updated
- `825` **added** product: NAN Supremepro (Owned) in NAN
- `550` Nancare: link updated
- `551` Nancare Kids: renamed from “Nancare Kids (gummies, 3+)”; link updated
- `552` BEBA: note: “Sold in German-speaking Europe.”; link updated
- `553` Guigoz (France): link updated
- `554` SMA (UK): note: “Came with Wyeth Nutrition in 2012.”; link updated
- `555` Lactogen: link updated
- `556` Nestogen: note: “Sold as Nestogeno in Brazil.”; link updated
- `557` Neslac (Brazil): renamed from “Neslac”; link updated
- `558` NaturNes: note: “Sold in France in 2024; still Nestlé's in Chile.”; link updated
- `560` Cerelac (Central and West Africa): renamed from “Cerelac Central & West Africa”
- `561` Nestum: note cleared; link updated
- `563` Nestonutri (Brazil): link updated
- `566` Piltti (Finland): link updated
- `567` Lactogrow: renamed from “Lactogrow / Ceregrow / Nangrow (India)”
- `568` Materna: renamed from “Materna (Mexico)”
- `569` Wyeth Nutrition: brand → group; note: “Acquired in 2012.”; link updated
- `570` Illuma: renamed from “Illuma (incl. Illuma HMO)”; product → brand; note cleared; link updated
- `571` S-26: renamed from “S-26 (Gold, Progress lines)”; product → brand; note cleared; link updated
- `572` Promil: renamed from “Promil / Promil Gold”; product → brand; note cleared; link updated
- `573` Bonna (Philippines): renamed from “Bonna”; product → brand
- `574` Bonina (Philippines): renamed from “Bonina”; product → brand; link updated
- `575` Ascenda: product → brand; link updated
- `819` **added** brand: Bonakid Pre-School (Philippines) (Owned) in Wyeth Nutrition
- `577` Specialty infant formulas: renamed from “Specialty infant formulas (HMO)”
- `539` Extensive HA: renamed from “Gerber Extensive HA (US)”; product → brand; moved to Specialty infant formulas; note cleared
- `578` Alfaré: renamed from “Alfaré HMO”
- `579` Althéra: renamed from “Althéra HMO”
- `580` Alfamino: renamed from “Alfamino HMO”
- `581` Nido: note cleared
- `583` Nido (Canada): renamed from “Nido Canada”
- `584` Nido (Mexico): renamed from “Nido Mexico”
- `585` Nido (Central and West Africa): renamed from “Nido Central & West Africa”
- `586` Nido (Philippines): renamed from “Nido Philippines”; link updated
- `587` Ninho (Brazil): note: “Chilled Ninho products are made by Lactalis under licence.”
- `817` **added** brand: Ceregrow (Owned) in Nutrition (infant and child)
- `818` **added** brand: Nangrow (Owned) in Nutrition (infant and child)
- `820` **added** brand: Good Start (Mexico) (Owned) in Nutrition (infant and child)
- `821` **added** brand: Nidina (Owned) in Nutrition (infant and child)
- `822` **added** brand: Nativa (Spain) (Owned) in Nutrition (infant and child)
- `823` **added** brand: Nidal (Owned) in Nutrition (infant and child)
- `824` **added** brand: Nestlé MOM (Owned) in Nutrition (infant and child)
- `537` **removed**: Gerber Mindful Parenting Collection

</details>

<details><summary><b>Nestlé Health Science</b> (37 rows)</summary>

- `591` Nestlé Health Science: note: “Medical nutrition, vitamins and supplements. Mainstream vitamin brands are being sold, closing by mid-2027.”
- `597` ThickenUp Clear: renamed from “ThickenUp / ThickenUp Clear”
- `599` Novasource: renamed from “Novasource (incl. Novasource Renal)”
- `600` Impact: renamed from “Impact (surgical immunonutrition)”
- `604` Vitaflo: renamed from “Vitaflo (inborn errors of metabolism)”
- `605` Modulen: link updated
- `606` Diabetisource: link updated
- `607` Fibersource: link updated
- `608` Glytrol: link updated
- `610` Optifibre: link updated
- `612` Meritene: link updated
- `613` Optifast: link updated
- `614` VOWST: renamed from “VOWST (oral microbiome therapy)”; note: “Fully acquired in 2024.”; link updated
- `590` Sustagen (Australia): renamed from “Sustagen”; moved to Active nutrition; note: “Elsewhere the Sustagen name belongs to another company.”
- `618` Vital Proteins: Majority → Owned; note cleared
- `619` Orgain: note: “Nestlé owns about 91%.”; link updated
- `620` Puravida (Brazil): Uncertain → Owned; note cleared; link updated
- `621` Mindful Chef (UK): renamed from “Mindful Chef (UK recipe boxes)”; note cleared; link updated
- `622` Premium vitamins and supplements: renamed from “Premium VMS (retained)”
- `623` Solgar: note cleared
- `624` Pure Encapsulations: note cleared
- `625` Garden of Life: note cleared
- `626` Douglas Laboratories: link updated
- `627` Genestra: link updated
- `629` Sundown: Uncertain → Owned; note cleared; link updated
- `826` **added** brand: Klean Athlete (Owned) in Premium vitamins and supplements
- `827` **added** brand: Minami (Owned) in Premium vitamins and supplements
- `631` Mainstream vitamins and supplements: renamed from “Mainstream VMS (sale to Yellow Wood Partners)”; brand → group; note: “Being sold to Yellow Wood Partners; closing expected by mid-2027.”
- `632` Nature's Bounty: product → brand
- `633` Puritan's Pride: product → brand
- `634` Osteo Bi-Flex: product → brand; link updated
- `635` Ester-C: product → brand; link updated
- `636` Gard: product → brand; link updated
- `637` Sisu (Canada): product → brand; link updated
- `638` Nuun: product → brand; note cleared; link updated
- `611` **removed**: Trophic
- `639` **removed**: US private-label supplements business

</details>

<details><summary><b>Nestlé Professional</b> (9 rows)</summary>

- `640` Nestlé Professional: note: “Foodservice brands; most professional ranges are listed under their retail brands.”
- `641` Minor's: renamed from “Minor's (bases)”; note cleared
- `644` Nestlé Vitality: renamed from “Nestlé Vitality (dispensed beverages)”
- `645` Sunkist: renamed from “Sunkist (foodservice)”; note cleared
- `648` Nestlé Barista: renamed from “Plant-based dairy alternatives (oat, pea, coconut)”
- `650` Chef: renamed from “Chef (Mexico)”; link updated
- `829` **added** brand: Sunsational (Owned) in Nestlé Professional
- `646` **removed**: Grown Respectfully
- `647` **removed**: Custom Innovation Group

</details>

<details><summary><b>Regional and country brands</b> (51 rows)</summary>

- `376` Neston: product → brand; moved to Brazil; Uncertain → Owned; note cleared
- `381` Nestlé Aveia: product → brand; moved to Brazil; Uncertain → Owned
- `649` Charge: renamed from “Charge (Brazil)”; moved to Brazil
- `659` Bono: renamed from “Bono (biscuits)”
- `660` Calipso: renamed from “Calipso (biscuits)”
- `661` Negresco: renamed from “Negresco (biscuits)”
- `662` Passatempo: renamed from “Passatempo (biscuits)”
- `663` Tostines: renamed from “Tostines (biscuits)”
- `665` Super 8: link updated
- `666` Trencito: link updated
- `667` Sahne-Nuss: renamed from “Sahne Nuss”; link updated
- `668` Chokita: note: “Renamed from Negrita in 2021.”
- `669` Capri (Chile): renamed from “Capri”
- `671` D'Onofrio: note: “Its ice cream is listed under Ice Cream.”; link updated
- `672` Sublime: product → brand; moved to Peru; link updated
- `673` Triángulo: product → brand; moved to Peru; link updated
- `674` Besos de Moza: product → brand; moved to Peru; link updated
- `676` Amor: link updated
- `677` Tango: link updated
- `681` Mabel's: link updated
- `683` Savoy: link updated
- `684` Osem-Nestlé (Israel): renamed from “Israel: Osem”; brand → group; note: “Fully owned by Nestlé since 2016.”; link updated
- `685` Bamba: product → brand; link updated
- `686` Bissli: product → brand; link updated
- `687` Tivall: renamed from “Tivall (meat substitutes)”; product → brand; link updated
- `688` Gratify: product → brand; link updated
- `693` Materna (Israel): renamed from “Materna Ltd (Israeli infant formula)”; product → brand; Majority → Owned; note cleared; link updated
- `694` Tzabar (Israel): renamed from “Sabra Salads (Israel)”; product → brand; Uncertain → Owned; note: “Not related to the US Sabra brand.”; link updated
- `828` **added** brand: Osem (Owned) in Osem-Nestlé (Israel)
- `696` Golden Morn: renamed from “Golden Morn (cereal)”; note cleared
- `698` Klim: renamed from “Klim (milk powder)”; link updated
- `699` Nespray: renamed from “Nespray (milk powder)”; link updated
- `700` Cerevita: renamed from “Cerevita (cereal)”; link updated
- `701` Tex: renamed from “Tex (chocolate)”; link updated
- `705` Choco Crossies (Germany): link updated
- `706` Bon Pari (Czech Republic): renamed from “Bon Pari (Poland)”; link updated
- `707` Princessa (Poland): link updated
- `708` Orion (Czech Republic/Slovakia): link updated
- `709` JOJO (Czech Republic/Slovakia): link updated
- `710` Szerencsi (Hungary): note: “Its chocolate bars are now sold as Szerecsen.”; link updated
- `712` Svitoch (Ukraine): link updated
- `716` Uncle Tobys: renamed from “Uncle Tobys (oats and snacks)”; note: “Its oats and cereals are listed under Cereals.”; link updated
- `718` Uncle Tobys Roll-Ups: link updated
- `719` Uncle Tobys Le Snak: link updated
- `720` Plaistowe: renamed from “Plaistowe (baking)”
- `721` Bakers' Choice: renamed from “Bakers Choice”
- `722` Quick-Eze: renamed from “Quick-Eze (antacid)”
- `678` **removed**: Argentina
- `691` **removed**: Asamim
- `702` **removed**: RWL
- `713` **removed**: Zvečevo (Croatia)

</details>

<details><summary><b>Joint ventures and minority stakes</b> (8 rows)</summary>

- `723` Joint ventures and minority stakes: note: “Stakes in other companies; most joint ventures sit in their own categories.”
- `724` Lactalis Nestlé Produits Frais: renamed from “Lactalis Nestlé Produits Frais (Europe chilled dairy)”; brand → group; note: “Nestlé owns 40%; Lactalis controls it.”
- `704` Hirz (Switzerland): moved to Lactalis Nestlé Produits Frais; Owned → Minority; link updated
- `725` La Laitière: product → brand; Licensed → Minority; note: “Nestlé brand made by the joint venture.”; link updated
- `726` Sveltesse: product → brand; Licensed → Minority; note: “Nestlé brand made by the joint venture.”; link updated
- `727` L'Oréal: note: “Nestlé owns about 20%; L'Oréal's brands are not Nestlé brands.”
- `728` IVC Evidensia: renamed from “IVC Evidensia (European vet clinics)”; note: “Minority stake since 2019.”; link updated
- `729` Drools: renamed from “Drools (India pet food)”; note: “Minority stake since 2025.”; link updated

</details>

<details><summary><b>Divested</b> (107 rows)</summary>

- `730` Divested: note: “Brands Nestlé has sold or discontinued.”
- `103` Supligen (Jamaica): moved to Divested; Owned → Divested; note: “Sold to the Musson Group in 2015.”; link updated
- `147` Dar Natury (Poland): renamed from “Dar Natury”; moved to Divested; Transitioning → Divested; note: “Sold with the Polish water delivery business in 2015.”; link updated
- `149` Neuselters: moved to Divested; Transitioning → Divested; note: “Sold in 2015.”; link updated
- `159` Nestlé Selda (Portugal): renamed from “Nestlé Selda”; moved to Divested; Transitioning → Divested; note: “Sold to Eden Springs in 2014.”; link updated
- `164` Pejo: moved to Divested; Uncertain → Divested; note: “Sold in 2014.”; link updated
- `165` Brazil waters: moved to Divested; Group → Divested; note: “Sold to Indaiá Minalba in 2018.”; link updated
- `166` São Lourenço: Transitioning → Divested; note cleared
- `167` Petrópolis: Transitioning → Divested; note cleared
- `168` Santa Bárbara: renamed from “Santa Bárbara (Águas de Santa Bárbara)”; Transitioning → Divested; note cleared
- `176` Porvenir: moved to Divested; Transitioning → Divested; note: “Nestlé sold its stake to CCU in 2026.”; link updated
- `182` Hidden Spring (Philippines): moved to Divested; Transitioning → Divested; note: “Sold to Universal Robina in 2007.”; link updated
- `184` Dashan Yunnan Spring (China): moved to Divested; Transitioning → Divested; note: “Sold to Tsingtao Brewery in 2020.”; link updated
- `185` Waterman (China): moved to Divested; Transitioning → Divested; note: “Sold to Tsingtao Brewery in 2020.”; link updated
- `491` Waggin' Train: moved to Divested; Uncertain → Divested; note: “Sold by Purina; now owned by Simply Protein for Pets.”; link updated
- `535` Good Start (US and Canada): renamed from “Gerber Good Start (infant formula)”; product → brand; moved to Divested; Owned → Divested; note: “Sold to Perrigo in 2022.”; link updated
- `628` Wobenzym: moved to Divested; Owned → Divested; note: “Sold to Dermapharm in 2026.”; link updated
- `630` Persona Nutrition: moved to Divested; Uncertain → Divested; note: “Bought back by its founders in 2024.”; link updated
- `689` Of Tov: product → brand; moved to Divested; Owned → Divested; note: “Spun off from Osem in 2005.”; link updated
- `690` Beit Hashita: product → brand; moved to Divested; Owned → Divested; note: “Sold around 2020.”; link updated
- `692` Tribe (US): renamed from “Tribe Mediterranean Foods”; product → brand; moved to Divested; Owned → Divested; note: “Sold in 2018.”; link updated
- `711` Boci (Hungary): moved to Divested; Owned → Divested; note: “Sold to Cerbona in 2024.”
- `731` Blue Bottle Coffee: note: “Sold to Centurium Capital in 2026; Nestlé kept the Blue Bottle capsules sold through Nespresso.”
- `732` Herta: note: “Sold to Casa Tarradellas in two steps, completed in 2025.”; link updated
- `733` US confectionery business: brand → group; note: “Sold to Ferrero in 2018.”
- `734` Butterfinger: product → brand; link updated
- `735` Baby Ruth: product → brand; link updated
- `736` 100 Grand: product → brand
- `737` Raisinets: product → brand
- `738` Wonka: renamed from “Wonka candy (Nerds, SweeTarts, Laffy Taffy, Gobstoppers)”; product → brand; link updated
- `739` Crunch (US): renamed from “Crunch (US rights)”; product → brand; note: “Nestlé still sells Crunch outside the US.”
- `740` SnoCaps: renamed from “Oh Henry! and SnoCaps”; product → brand
- `830` **added** brand: Nerds (Divested) in US confectionery business
- `831` **added** brand: SweeTARTS (Divested) in US confectionery business
- `832` **added** brand: Laffy Taffy (Divested) in US confectionery business
- `833` **added** brand: Gobstopper (Divested) in US confectionery business
- `842` **added** brand: Oh Henry! (US) (Divested) in US confectionery business
- `741` Violet Crumble: note: “Sold to Robern Menz in 2018.”; link updated
- `742` US and Canada waters: brand → group; note: “Sold in 2021; now part of Primo Brands.”
- `743` Arrowhead: product → brand
- `744` Poland Spring: product → brand
- `745` Deer Park: product → brand
- `746` Ozarka: product → brand
- `747` Zephyrhills: product → brand
- `748` Ice Mountain: product → brand
- `749` Calistoga: product → brand; note: “Dropped by the buyer after the sale.”
- `750` Pure Life (US and Canada): renamed from “Pure Life US/Canada (incl. Pureza Vital, Vie Pure)”; product → brand; note: “Nestlé still owns the name and licenses it to the buyer.”
- `751` Montclair (Canada): renamed from “Montclair”; product → brand
- `753` Splash Refresher: renamed from “Splash / Fruity Water”; product → brand
- `755` ReadyRefresh: product → brand; link updated
- `756` Acqua Vera: renamed from “Acqua Vera / Nestlé Vera”; note: “Sold to the Quagliuolo family in 2020.”
- `757` Recoaro: note: “Sold to Refresco in 2016.”; link updated
- `758` San Bernardo: note: “Sold to Gruppo Montecristo in 2015.”; link updated
- `759` Quézac: renamed from “Plancoët, Quézac, Saint-Lambert, Sainte-Alix (France waters)”; note: “Sold to the Ogeu group in 2017.”; link updated
- `760` Chameleon Cold-Brew: renamed from “Chameleon Organic Coffee”; note: “Sold to Systm Foods in 2022.”; link updated
- `761` Juicy Juice: note: “Sold in 2014; now owned by Harvest Hill Beverage.”; link updated
- `763` Yinlu: renamed from “Yinlu (peanut milk, rice porridge)”; note: “Sold back to its founding family in 2020.”
- `764` Dairy Partners Americas (Brazil): renamed from “Dairy Partners Americas Brazil (chilled dairy)”; brand → group; note: “Joint venture with Fonterra; sold to Lactalis in 2023.”
- `765` Chamyto: product → brand; link updated
- `766` Chambinho: product → brand; link updated
- `767` Chandelle: product → brand
- `769` Mousline: note: “Sold to FnB Private Equity in 2022.”
- `770` La Cocinera (Spain): renamed from “La Cocinera (Spain frozen)”; note: “Sold to Findus in 2015; now part of Nomad Foods.”; link updated
- `771` Hemglass: note: “Sold to Varsego in 2013.”; link updated
- `772` Branston: renamed from “Branston and Sarson's”; note: “Sold to Premier Foods; owned by Mizkan since 2012.”; link updated
- `773` Alpine (Philippines): renamed from “Philippine dairy (Goya/Kean's; Magnolia; Alpine, Krem Top, Liberty)”; note: “Sold to Alaska Milk in 2007.”; link updated
- `774` Gerber Life Insurance: note: “Sold to Western & Southern in 2019; Nestlé still owns the Gerber name.”; link updated
- `775` Nestlé Skin Health (now Galderma): renamed from “Nestlé Skin Health (Galderma, Cetaphil, Proactiv, Restylane)”; brand → group; note: “Sold to an investor group led by EQT in 2019.”; link updated
- `840` **added** brand: Cetaphil (Divested) in Nestlé Skin Health (now Galderma)
- `841` **added** brand: Restylane (Divested) in Nestlé Skin Health (now Galderma)
- `776` Palforzia: renamed from “Palforzia (Aimmune peanut-allergy drug)”; note: “Sold to Stallergenes Greer in 2023.”; link updated
- `777` Alcon: note: “Sold to Novartis in stages, completed in 2010.”; link updated
- `779` PurinaCare: renamed from “PurinaCare pet insurance”; note: “Sold to Pethealth in 2013.”
- `94` Nescafé Partners' Blend (UK): renamed from “Partner's Blend”; moved to Discontinued (not sold); Owned → Discontinued; link updated
- `139` Cristalp (Switzerland): renamed from “Cristalp”; moved to Discontinued (not sold); Transitioning → Discontinued; note: “Dropped by Nestlé in 2022.”
- `243` Allen's Sourz: renamed from “Sourz”; product → brand; moved to Discontinued (not sold); Owned → Discontinued
- `249` Nestlé Toll House Café by Chip: product → brand; moved to Discontinued (not sold); Licensed → Discontinued; note: “Licence ended in 2022.”
- `297` Lean Pockets: product → brand; moved to Discontinued (not sold); Uncertain → Discontinued; note: “Dropped in 2020.”; link updated
- `303` Sweet Earth: moved to Discontinued (not sold); Uncertain → Discontinued; note: “Dropped from Nestlé's US range; no sale announced.”
- `307` Garden Gourmet frozen pizza: product → brand; moved to Discontinued (not sold); Minority → Discontinued; note: “Dropped in 2025.”
- `457` Yesterday's News: product → brand; moved to Discontinued (not sold); Uncertain → Discontinued; note: “Discontinued in 2022.”; link updated
- `473` Castor & Pollux: renamed from “Castor & Pollux (Organix, Pristine)”; product → brand; moved to Discontinued (not sold); Uncertain → Discontinued; note: “Merrick's organic line; ended in 2024.”; link updated
- `474` Whole Earth Farms: product → brand; moved to Discontinued (not sold); Uncertain → Discontinued; note cleared; link updated
- `492` Canyon Creek Ranch: moved to Discontinued (not sold); Uncertain → Discontinued
- `493` Mighty Dog: moved to Discontinued (not sold); Uncertain → Discontinued; note: “Purina dog food; ended in 2020.”; link updated
- `494` Purina Muse: renamed from “Muse”; moved to Discontinued (not sold); Uncertain → Discontinued; link updated
- `495` Tender Vittles: moved to Discontinued (not sold); Uncertain → Discontinued; note: “Purina cat food.”; link updated
- `565` Bona (Finland): moved to Discontinued (not sold); Owned → Discontinued
- `576` Belsol (China): renamed from “Belsol (China super-premium)”; product → brand; moved to Discontinued (not sold); Owned → Discontinued
- `609` Crucial: moved to Discontinued (not sold); Owned → Discontinued
- `768` Sollys (Brazil): renamed from “Sollys”; product → brand; moved to Discontinued (not sold); Divested → Discontinued
- `783` Beyond: renamed from “Beyond (US)”; note: “Discontinued in the US and Europe.”; link updated
- `784` Fantales: renamed from “Fantales (Allen's)”; note: “Discontinued in 2023.”; link updated
- `813` **added** brand: Bella (Discontinued) in Discontinued (not sold). Note: Purina small-dog food.
- `793` **added** brand: Fürst Bismarck (Divested) in Divested. Note: Sold in 2017.
- `834` **added** brand: Plancoët (Divested) in Divested. Note: Sold to the Ogeu group in 2014.
- `835` **added** brand: Saint-Lambert (Divested) in Divested. Note: Sold to the Ogeu group in 2013.
- `836` **added** brand: Sainte-Alix (Divested) in Divested. Note: Sold to the Ogeu group in 2014.
- `837` **added** brand: Sarson's (Divested) in Divested. Note: Sold to Premier Foods; owned by Mizkan since 2012.
- `838` **added** brand: Krem-Top (Divested) in Divested. Note: Sold to Alaska Milk in 2007.
- `839` **added** brand: Liberty (Philippines) (Divested) in Divested. Note: Sold to Alaska Milk in 2007.
- `752` **removed**: Aberfoyle
- `754` **removed**: Deep Spring
- `762` **removed**: Nestea Philippines RTD
- `778` **removed**: Meow Mix and Alley Cat
- `780` **removed**: European small-pet food business
- `781` **removed**: Nestlé South Africa pet food

</details>
