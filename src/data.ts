/* ==========================================================================
   The Nestlé Empire — data
   --------------------------------------------------------------------------
   SAMPLE DATA for the prototype. Replace / extend with the real list.
   Field-by-field docs live in ./types.ts; the editor will flag typos.

   - Brands hang off a category, or off another brand (`parent`).
   - status: "owned" | "partial" | "former".
   - Images: drop files in public/images/ and set `image: "images/<id>.png"`,
     or set `wiki` to a Wikipedia title to borrow that article's lead image.
   - Extra connections between any two circles go in `links` at the bottom.
   ========================================================================== */

import type { EmpireData } from "./types";

export const DATA: EmpireData = {
  root: {
    id: "nestle",
    name: "Nestlé",
    description: "Food & drink company",
    note: "Founded in 1866 in Vevey, Switzerland. The world's largest food company by revenue.",
    url: "https://www.nestle.com",
    wiki: "Nestlé",
  },

  categories: [
    { id: "coffee",        name: "Coffee",             color: "#7a4e30", description: "Coffee & creamers" },
    { id: "confectionery", name: "Confectionery",      color: "#b4443c", description: "Chocolate, sweets & baking" },
    { id: "petcare",       name: "Pet Care",           color: "#cf8a32", description: "Food & care for cats and dogs" },
    { id: "waters",        name: "Waters",             color: "#4e8a92", description: "Mineral & spring waters" },
    { id: "nutrition",     name: "Nutrition & Health", color: "#6f8f4e", description: "Infant nutrition, supplements & medical nutrition" },
    { id: "foods",         name: "Prepared Foods",     color: "#c4683a", description: "Frozen meals, pizza, pasta & seasonings" },
    { id: "drinks",        name: "Milk & Drinks",      color: "#5e7fa8", description: "Flavoured milk & malted drinks" },
    { id: "icecream",      name: "Ice Cream",          color: "#cc6f84", description: "Frozen desserts" },
    { id: "beauty",        name: "Beauty & Skin",      color: "#8a5a7a", description: "Cosmetics & dermatology" },
  ],

  brands: [
    // Coffee
    { id: "nescafe",      name: "Nescafé",            parent: "coffee", status: "owned",   description: "Instant coffee",                 url: "https://www.nescafe.com",       wiki: "Nescafé", size: 18 },
    { id: "nespresso",    name: "Nespresso",          parent: "coffee", status: "owned",   description: "Coffee capsules & machines",     url: "https://www.nespresso.com",     wiki: "Nespresso", size: 18 },
    { id: "dolce-gusto",  name: "Dolce Gusto",        parent: "coffee", status: "owned",   description: "Capsule coffee machines",        url: "https://www.dolce-gusto.com",   wiki: "Dolce Gusto" },
    { id: "coffee-mate",  name: "Coffee mate",        parent: "coffee", status: "owned",   description: "Coffee creamer",                 url: "https://www.coffeemate.com",    wiki: "Coffee-Mate" },
    { id: "blue-bottle",  name: "Blue Bottle Coffee", parent: "coffee", status: "partial", description: "Specialty coffee roaster & cafés", url: "https://bluebottlecoffee.com", wiki: "Blue Bottle Coffee",
      stake: 0.68, note: "Nestlé bought a majority stake (about 68%) in 2017." },

    // Confectionery
    { id: "kitkat",       name: "KitKat",             parent: "confectionery", status: "owned",  description: "Chocolate-covered wafer bar", url: "https://www.kitkat.com", wiki: "Kit Kat", size: 18,
      note: "Made by Hershey in the US under a licence; Nestlé everywhere else." },
    { id: "smarties",     name: "Smarties",           parent: "confectionery", status: "owned",  description: "Candy-coated chocolates",    url: "https://www.nestle-confectionery.co.uk/brands/smarties", wiki: "Smarties" },
    { id: "toll-house",   name: "Toll House",         parent: "confectionery", status: "owned",  description: "Baking chips & cookie dough", url: "https://www.verybestbaking.com" },
    { id: "butterfinger", name: "Butterfinger",       parent: "confectionery", status: "former", description: "Peanut butter crisp bar",    url: "https://www.butterfinger.com", wiki: "Butterfinger",
      note: "Sold to Ferrero in 2018 with Nestlé's US candy business." },
    { id: "baby-ruth",    name: "Baby Ruth",          parent: "confectionery", status: "former", description: "Peanut & caramel candy bar", url: "https://www.babyruth.com", wiki: "Baby Ruth",
      note: "Sold to Ferrero in 2018 with Nestlé's US candy business." },

    // Pet care
    { id: "purina",       name: "Purina",             parent: "petcare", status: "owned", description: "Pet food & care",    url: "https://www.purina.com", wiki: "Nestlé Purina PetCare", size: 22,
      note: "Nestlé bought Ralston Purina in 2001 and merged it with Friskies." },
    { id: "fancy-feast",  name: "Fancy Feast",        parent: "purina",  status: "owned", description: "Cat food",           url: "https://www.purina.com/fancy-feast", wiki: "Fancy Feast" },
    { id: "friskies",     name: "Friskies",           parent: "purina",  status: "owned", description: "Cat food",           url: "https://www.purina.com/friskies",    wiki: "Friskies" },
    { id: "pro-plan",     name: "Pro Plan",           parent: "purina",  status: "owned", description: "Premium pet food",   url: "https://www.purina.com/pro-plan" },
    { id: "beneful",      name: "Beneful",            parent: "purina",  status: "owned", description: "Dog food",           url: "https://www.purina.com/beneful",     wiki: "Beneful" },
    { id: "tidy-cats",    name: "Tidy Cats",          parent: "purina",  status: "owned", description: "Cat litter",         url: "https://www.purina.com/tidy-cats" },

    // Waters
    { id: "perrier",       name: "Perrier",           parent: "waters", status: "owned",  description: "Sparkling mineral water", url: "https://www.perrier.com",       wiki: "Perrier", size: 17 },
    { id: "s-pellegrino",  name: "S.Pellegrino",      parent: "waters", status: "owned",  description: "Sparkling mineral water", url: "https://www.sanpellegrino.com", wiki: "Sanpellegrino" },
    { id: "acqua-panna",   name: "Acqua Panna",       parent: "waters", status: "owned",  description: "Still spring water",      url: "https://www.acquapanna.com",    wiki: "Acqua Panna" },
    { id: "vittel",        name: "Vittel",            parent: "waters", status: "owned",  description: "Still mineral water",     url: "https://www.vittel.com",        wiki: "Vittel (water)" },
    { id: "poland-spring", name: "Poland Spring",     parent: "waters", status: "former", description: "Spring water",            url: "https://www.polandspring.com",  wiki: "Poland Spring",
      note: "Sold in 2021 along with Nestlé's North American water business." },

    // Nutrition & health
    { id: "gerber",        name: "Gerber",            parent: "nutrition", status: "owned",  description: "Baby food",               url: "https://www.gerber.com",              wiki: "Gerber Products Company", size: 18 },
    { id: "garden-of-life",name: "Garden of Life",    parent: "nutrition", status: "owned",  description: "Organic supplements",     url: "https://www.gardenoflife.com" },
    { id: "pure-encaps",   name: "Pure Encapsulations", parent: "nutrition", status: "owned", description: "Hypoallergenic supplements", url: "https://www.pureencapsulations.com" },
    { id: "natures-bounty",name: "Nature's Bounty",   parent: "nutrition", status: "owned",  description: "Vitamins & supplements",  url: "https://www.naturesbounty.com",       wiki: "Nature's Bounty" },
    { id: "boost",         name: "Boost",             parent: "nutrition", status: "owned",  description: "Nutritional drinks",      url: "https://www.boost.com",               wiki: "Boost (drink)" },

    // Prepared foods
    { id: "maggi",         name: "Maggi",             parent: "foods", status: "owned", description: "Instant noodles & seasonings", url: "https://www.maggi.com",       wiki: "Maggi", size: 18 },
    { id: "buitoni",       name: "Buitoni",           parent: "foods", status: "owned", description: "Fresh pasta & sauces",         url: "https://www.buitoni.com",     wiki: "Buitoni" },
    { id: "stouffers",     name: "Stouffer's",        parent: "foods", status: "owned", description: "Frozen meals",                 url: "https://www.stouffers.com",   wiki: "Stouffer's" },
    { id: "lean-cuisine",  name: "Lean Cuisine",      parent: "foods", status: "owned", description: "Lighter frozen meals",         url: "https://www.leancuisine.com", wiki: "Lean Cuisine" },
    { id: "digiorno",      name: "DiGiorno",          parent: "foods", status: "owned", description: "Frozen pizza",                 url: "https://www.digiorno.com",    wiki: "DiGiorno" },
    { id: "hot-pockets",   name: "Hot Pockets",       parent: "foods", status: "owned", description: "Frozen stuffed sandwiches",    url: "https://www.hotpockets.com",  wiki: "Hot Pockets" },

    // Milk & drinks
    { id: "nesquik",       name: "Nesquik",           parent: "drinks", status: "owned", description: "Chocolate milk & cocoa mix",   url: "https://www.nesquik.com",  wiki: "Nesquik" },
    { id: "milo",          name: "Milo",              parent: "drinks", status: "owned", description: "Chocolate malt drink",         url: "https://www.milo.com.au",  wiki: "Milo (drink)" },

    // Ice cream
    { id: "froneri",       name: "Froneri",           parent: "icecream", status: "partial", description: "Ice cream maker", url: "https://www.froneri.com", wiki: "Froneri", size: 18,
      stake: 0.5, note: "A 50/50 joint venture with PAI Partners, formed in 2016. Nestlé moved most of its ice cream brands into it." },

    // Beauty & skin
    { id: "loreal",        name: "L'Oréal",           parent: "beauty", status: "partial", description: "Cosmetics & beauty", url: "https://www.loreal.com", wiki: "L'Oréal", size: 18,
      stake: 0.2, note: "Nestlé is one of L'Oréal's biggest shareholders, with roughly 20%." },
    { id: "galderma",      name: "Galderma",          parent: "beauty", status: "former",  description: "Dermatology & skincare", url: "https://www.galderma.com", wiki: "Galderma",
      note: "Sold in 2019 to a group of investors led by EQT." },
  ],

  // Extra connections beyond the parent → child tree.
  links: [
    { source: "galderma", target: "loreal", note: "Galderma began in 1981 as a joint venture between Nestlé and L'Oréal." },
    { source: "garden-of-life", target: "pure-encaps", note: "Both joined Nestlé in 2017 through the purchase of Atrium Innovations." },
  ],
};
