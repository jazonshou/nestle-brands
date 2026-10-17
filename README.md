# The Nestlé Empire

A one-page interactive map of the brands Nestlé owns, partly owns, and used to own.
Each brand is a circle. Lines connect it to its category (or parent brand). Click a circle to see an image, a short description, and a link to its website.

Built with TypeScript, [Vite](https://vite.dev), and [d3-force](https://d3js.org/d3-force) for the layout. Deployed to GitHub Pages by a GitHub Actions workflow.

## Run it locally

Needs Node 20.19+ or 22.12+.

```bash
npm install
```

```bash
npm run dev
```

Then open http://localhost:5173. The page reloads as you edit.

To check the production build exactly as GitHub Pages will serve it:

```bash
npm run build && npm run preview
```

## Controls

| Action | How |
| --- | --- |
| Move around | Two-finger scroll (any direction), right-click and drag, or drag empty space |
| Zoom | Pinch, ⌘/Ctrl + scroll, or the + / − buttons |
| Details | Click a circle |
| Rearrange | Drag a circle |
| Find a brand | Type in the search box (press `/` to jump there) |
| Filter | Click Owned / Partly owned / Formerly owned in the legend |
| Keyboard | Arrow keys pan · `+` `-` zoom · `0` show everything · `Esc` close details |

## Editing the brands

All content lives in [`src/data.ts`](src/data.ts). The fields are documented in [`src/types.ts`](src/types.ts), and the type checker catches typos and missing fields.

```ts
{
  id: "fancy-feast",
  name: "Fancy Feast",
  parent: "purina",            // a category id, or another brand's id
  status: "owned",             // "owned" | "partial" | "former"
  description: "Cat food",
  url: "https://www.purina.com/fancy-feast",
  image: "images/fancy-feast.png",  // optional, see below
}
```

- **Partly owned** brands can set `stake` (0–1), which is drawn as a pie slice inside the circle.
- **Formerly owned** brands get a dashed outline and connection line. Use `note` to say when and to whom they were sold.
- **Extra connections** between any two circles (e.g. Galderma ↔ L'Oréal) go in the `links` array at the bottom of the file.
- If an `id` or `parent` doesn't match anything, a warning appears in the browser console and the brand attaches to Nestlé so it stays visible.

### Images

Put image files in `public/images/` and reference them as `image: "images/<file>"`.
If a brand has no `image` but has a `wiki` title, the panel borrows the lead image from that Wikipedia article. Wikipedia often has no free image for logos, so local images are more reliable. When there's no image at all, the panel shows the brand's initials.

## Deploying to GitHub Pages

1. Create a GitHub repository and push this project to its `main` branch.
2. In the repository, go to **Settings → Pages → Build and deployment** and set **Source** to **GitHub Actions**.
3. Every push to `main` now runs [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). It installs dependencies, type-checks, builds, and publishes `dist/`. You can also run it by hand from the **Actions** tab.

The site will be live at `https://<your-username>.github.io/<repo-name>/`. Asset paths are relative, so any repository name works without changing the config.

## Project layout

```
index.html            page shell (header, legend, controls, detail panel)
src/
  data.ts             ← the brands; edit this
  types.ts            data field definitions
  graph.ts            turns data into nodes/links and lays them out
  camera.ts           pan / zoom state and smooth fly-to animations
  input.ts            scroll, pinch, right-drag, touch and node dragging
  panel.ts            the detail card, including image loading
  search.ts           the brand search box
  main.ts             draws the SVG and wires everything together
  styles.css          all styling (colours are CSS variables at the top)
public/images/        your brand images (copied as-is into the build)
.github/workflows/    GitHub Pages deployment
```

---

Independent project, not affiliated with Nestlé. Brand names and logos belong to their owners.
